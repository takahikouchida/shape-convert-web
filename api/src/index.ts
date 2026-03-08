import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { parse as parseCsv } from 'csv-parse/sync';
import { stringify as stringifyCsv } from 'csv-stringify/sync';
import iconv from 'iconv-lite';
import unzipper from 'unzipper';
import { createWriteStream } from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join, extname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const port = Number(process.env.PORT ?? '8080');
const host = process.env.HOST ?? '0.0.0.0';
const jobsRoot = process.env.JOBS_ROOT ?? '/tmp/shape-convert-jobs';
const outputSrs = 'EPSG:4326';
const jobTtlMs = 7 * 24 * 60 * 60 * 1000;
const cleanupIntervalMs = 60 * 60 * 1000;

const server = Fastify({
  logger: true,
  bodyLimit: 200 * 1024 * 1024
});

await server.register(cors, {
  origin: true
});

await server.register(multipart, {
  limits: {
    fileSize: 200 * 1024 * 1024,
    files: 1
  }
});

await mkdir(jobsRoot, { recursive: true });

type UploadFields = {
  shapeEncoding: string;
  sourceEpsg: string | null;
};

type JobMetadata = {
  id: string;
  shapeEncoding: string;
  requestedInputEncoding: string;
  detectedCpg: string | null;
  sourceEpsg: string | null;
  hasPrj: boolean;
  shapefileBaseName: string;
  shapefilePath: string;
  hasPointGeometry: boolean;
  columns: string[];
};

type FeatureCollectionLike = {
  type: 'FeatureCollection';
  features?: Array<{
    properties?: Record<string, unknown>;
  }>;
};

type CsvEncoding = 'utf8' | 'utf8bom' | 'cp932';
const latitudeColumn = 'latitude';
const longitudeColumn = 'longitude';

function normalizeInputEncoding(raw: string | undefined): string {
  const value = (raw ?? 'AUTO').trim();
  return value === '' ? 'AUTO' : value;
}

function resolveShapeEncoding(inputEncoding: string, detectedCpg: string | null): string {
  if (inputEncoding !== 'AUTO') {
    return inputEncoding;
  }

  if (detectedCpg && detectedCpg.trim() !== '') {
    return detectedCpg.trim();
  }

  return 'AUTO';
}

function normalizeSourceEpsg(raw: string | undefined): string | null {
  if (!raw || raw.trim() === '') {
    return null;
  }

  const value = raw.trim().toUpperCase().replace(/^EPSG:/, '');
  if (!/^\d{3,6}$/.test(value)) {
    throw new Error('EPSGコードは数字で指定してください（例: 4326）。');
  }

  return `EPSG:${value}`;
}

function normalizeCsvEncoding(raw: unknown): CsvEncoding {
  const value = String(raw ?? 'utf8').trim().toLowerCase();
  if (value === 'utf8' || value === 'utf8bom' || value === 'cp932') {
    return value;
  }
  throw new Error('CSV文字コードは utf8 / utf8bom / cp932 のいずれかを指定してください。');
}

function parseSelectedColumns(raw: unknown): string[] | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }

  const values = Array.isArray(raw) ? raw : [raw];
  const split = values
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (split.length === 0) {
    return [];
  }

  return split;
}

function parsePositiveInt(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 1) {
    return fallback;
  }
  return Math.floor(num);
}

async function listFilesRecursively(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(fullPath)));
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function cleanupExpiredJobs(): Promise<void> {
  const now = Date.now();
  const entries = await readdir(jobsRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const jobDirPath = join(jobsRoot, entry.name);
    try {
      const info = await stat(jobDirPath);
      if (now - info.mtimeMs > jobTtlMs) {
        await rm(jobDirPath, { recursive: true, force: true });
        server.log.info({ jobId: entry.name }, 'Expired job deleted');
      }
    } catch (error) {
      server.log.warn({ err: error, jobId: entry.name }, 'Failed to inspect or delete expired job');
    }
  }
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

async function readDetectedCpg(cpgPath: string): Promise<string | null> {
  if (!(await exists(cpgPath))) {
    return null;
  }

  const cpgRaw = await readFile(cpgPath, 'utf-8');
  const normalized = cpgRaw.trim();
  return normalized === '' ? null : normalized;
}

async function loadJobMetadata(jobId: string): Promise<JobMetadata | null> {
  const metadataPath = join(jobsRoot, jobId, 'metadata.json');
  if (!(await exists(metadataPath))) {
    return null;
  }

  const raw = await readFile(metadataPath, 'utf-8');
  return JSON.parse(raw) as JobMetadata;
}

async function loadGeoJson(jobId: string): Promise<FeatureCollectionLike | null> {
  const geoJsonPath = join(jobsRoot, jobId, 'output', 'result.geojson');
  if (!(await exists(geoJsonPath))) {
    return null;
  }

  const raw = await readFile(geoJsonPath, 'utf-8');
  return JSON.parse(raw) as FeatureCollectionLike;
}

function buildTransformArgs(
  inputShpPath: string,
  outputPath: string,
  fields: UploadFields,
  hasPrj: boolean,
  format: 'GeoJSON' | 'CSV',
  selectedColumns?: string[]
): string[] {
  const args = ['-f', format, outputPath, inputShpPath];

  if (fields.shapeEncoding !== 'AUTO') {
    args.unshift(fields.shapeEncoding);
    args.unshift('SHAPE_ENCODING');
    args.unshift('--config');
  }

  if (hasPrj) {
    args.push('-t_srs', outputSrs);
  } else {
    if (!fields.sourceEpsg) {
      throw new Error('PRJファイルがないため、EPSGコードの指定が必須です。');
    }
    args.push('-s_srs', fields.sourceEpsg, '-t_srs', outputSrs);
  }

  if (format === 'CSV') {
    if (selectedColumns && selectedColumns.length > 0) {
      args.push('-select', selectedColumns.join(','));
    }
    args.push('-lco', 'GEOMETRY=AS_WKT');
  }

  return args;
}

function encodeCsv(dataUtf8: Buffer, encoding: CsvEncoding): { body: Buffer; charset: string } {
  if (encoding === 'utf8') {
    return { body: dataUtf8, charset: 'utf-8' };
  }

  if (encoding === 'utf8bom') {
    return { body: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), dataUtf8]), charset: 'utf-8' };
  }

  return { body: iconv.encode(dataUtf8.toString('utf-8'), 'cp932'), charset: 'cp932' };
}

async function runOgr2ogr(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ogr2ogr', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `ogr2ogr exited with code ${code}`));
    });
  });
}

async function loadColumnsFromGeoJson(geoJsonPath: string): Promise<string[]> {
  const raw = await readFile(geoJsonPath, 'utf-8');
  const parsed = JSON.parse(raw) as { features?: Array<{ properties?: Record<string, unknown> }> };

  const columns: string[] = [];
  for (const feature of parsed.features ?? []) {
    columns.push(...Object.keys(feature.properties ?? {}));
  }

  return unique(columns);
}

function extractPointLatLon(geometry: unknown): { latitude: number | null; longitude: number | null } {
  if (!geometry || typeof geometry !== 'object') {
    return { latitude: null, longitude: null };
  }

  const g = geometry as { type?: string; coordinates?: unknown };
  if (g.type === 'Point' && Array.isArray(g.coordinates) && typeof g.coordinates[0] === 'number' && typeof g.coordinates[1] === 'number') {
    return { latitude: g.coordinates[1], longitude: g.coordinates[0] };
  }

  if (g.type === 'MultiPoint' && Array.isArray(g.coordinates) && Array.isArray(g.coordinates[0])) {
    const first = g.coordinates[0] as unknown[];
    if (typeof first[0] === 'number' && typeof first[1] === 'number') {
      return { latitude: first[1], longitude: first[0] };
    }
  }

  return { latitude: null, longitude: null };
}

function hasPointFeature(geojson: FeatureCollectionLike): boolean {
  return (geojson.features ?? []).some((feature) => {
    const geometry = (feature as { geometry?: { type?: string } }).geometry;
    return geometry?.type === 'Point' || geometry?.type === 'MultiPoint';
  });
}

function parseWktPointLatLon(wkt: string | null | undefined): { latitude: number | null; longitude: number | null } {
  if (!wkt) {
    return { latitude: null, longitude: null };
  }
  const normalized = wkt.trim().replace(/\s+/g, ' ');
  const match = normalized.match(/^POINT(?: Z| M| ZM)? \(([-\d.]+) ([-\d.]+)/i);
  if (!match) {
    return { latitude: null, longitude: null };
  }
  const lon = Number(match[1]);
  const lat = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { latitude: null, longitude: null };
  }
  return { latitude: lat, longitude: lon };
}

server.get('/health', async () => {
  return {
    ok: true,
    service: 'shape-convert-api'
  };
});

server.post('/api/upload', async (request, reply) => {
  const jobId = randomUUID();
  const jobDir = join(jobsRoot, jobId);
  const uploadZipPath = join(jobDir, 'upload.zip');
  const extractedDir = join(jobDir, 'extracted');
  const outputDir = join(jobDir, 'output');

  try {
    await mkdir(jobDir, { recursive: true });
    await mkdir(extractedDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    let fileUploaded = false;
    let inputEncodingRaw: string | undefined;
    let sourceEpsgRaw: string | undefined;

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (fileUploaded) {
          return reply.code(400).send({ error: 'アップロードできるファイルは1つまでです。' });
        }

        if (extname(part.filename).toLowerCase() !== '.zip') {
          return reply.code(400).send({ error: 'ZIPファイル（.zip）のみアップロードできます。' });
        }

        await pipeline(part.file, createWriteStream(uploadZipPath));
        fileUploaded = true;
      } else if (part.type === 'field') {
        if (part.fieldname === 'inputEncoding') {
          inputEncodingRaw = String(part.value ?? '');
        }
        if (part.fieldname === 'sourceEpsg') {
          sourceEpsgRaw = String(part.value ?? '');
        }
      }
    }

    if (!fileUploaded) {
      return reply.code(400).send({ error: 'ZIPファイルをアップロードしてください。' });
    }

    const inputEncoding = normalizeInputEncoding(inputEncodingRaw);

    let sourceEpsg: string | null;
    try {
      sourceEpsg = normalizeSourceEpsg(sourceEpsgRaw);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }

    const zipDirectory = await unzipper.Open.file(uploadZipPath);
    await zipDirectory.extract({ path: extractedDir, concurrency: 5 });

    const extractedFiles = await listFilesRecursively(extractedDir);
    const shapefiles = extractedFiles.filter((file) => {
      const lower = file.toLowerCase();
      const base = basename(file);
      if (extname(lower) !== '.shp') {
        return false;
      }
      // Ignore macOS metadata files bundled in ZIP (e.g. __MACOSX/._foo.shp).
      if (lower.includes('/__macosx/') || base.startsWith('._')) {
        return false;
      }
      return true;
    });

    if (shapefiles.length === 0) {
      return reply.code(400).send({ error: 'ZIP内にShapefile（.shp）が見つかりません。' });
    }
    if (shapefiles.length > 1) {
      return reply.code(400).send({
        error: 'ZIP内に複数のShapefile（.shp）が存在します。1つだけ含めてアップロードしてください。'
      });
    }

    const selectedShpPath = shapefiles[0];
    const shpBasePath = selectedShpPath.slice(0, -4);
    const requiredPaths = ['.shx', '.dbf'].map((ext) => `${shpBasePath}${ext}`);

    for (const requiredPath of requiredPaths) {
      if (!(await exists(requiredPath))) {
        return reply.code(400).send({
          error: `必須ファイルが不足しています: ${basename(requiredPath)}`
        });
      }
    }

    const prjPath = `${shpBasePath}.prj`;
    const hasPrj = await exists(prjPath);
    if (!hasPrj && !sourceEpsg) {
      return reply.code(400).send({
        error: '.prj が存在しないため、EPSGコードの指定が必須です。'
      });
    }

    const detectedCpg = await readDetectedCpg(`${shpBasePath}.cpg`);
    const shapeEncoding = resolveShapeEncoding(inputEncoding, detectedCpg);

    const fields: UploadFields = {
      shapeEncoding,
      sourceEpsg
    };

    const geoJsonPath = join(outputDir, 'result.geojson');

    await runOgr2ogr(buildTransformArgs(selectedShpPath, geoJsonPath, fields, hasPrj, 'GeoJSON'));

    const geojson = await loadGeoJson(jobId);
    if (!geojson) {
      return reply.code(500).send({ error: 'GeoJSON生成結果の読み込みに失敗しました。' });
    }
    const baseColumns = await loadColumnsFromGeoJson(geoJsonPath);
    const hasPoint = hasPointFeature(geojson);
    const columns = hasPoint ? [...baseColumns, latitudeColumn, longitudeColumn] : baseColumns;

    const metadata: JobMetadata = {
      id: jobId,
      requestedInputEncoding: inputEncoding,
      shapeEncoding,
      detectedCpg,
      sourceEpsg,
      hasPrj,
      shapefileBaseName: basename(shpBasePath),
      shapefilePath: selectedShpPath,
      hasPointGeometry: hasPoint,
      columns
    };
    await writeFile(join(jobDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');

    return reply.send({
      jobId,
      hasPrj,
      selectedShapefile: basename(selectedShpPath),
      sourceEpsg,
      inputEncoding: shapeEncoding,
      requestedInputEncoding: inputEncoding,
      detectedCpg,
      columns,
      previewUrl: `/api/jobs/${jobId}/preview`,
      downloads: {
        geojson: `/api/jobs/${jobId}/download.geojson`,
        csv: `/api/jobs/${jobId}/download.csv`
      }
    });
  } catch (error) {
    request.log.error(error);
    await rm(jobDir, { recursive: true, force: true });
    return reply.code(500).send({
      error: '変換処理に失敗しました。入力データまたは文字コード/EPSG指定を確認してください。'
    });
  }
});

server.get('/api/jobs/:jobId/preview', async (request, reply) => {
  const { jobId } = request.params as { jobId: string };
  const geojson = await loadGeoJson(jobId);
  if (!geojson) {
    return reply.code(404).send({ error: '指定されたジョブが見つかりません。' });
  }

  reply.type('application/geo+json; charset=utf-8');
  return reply.send(geojson);
});

server.get('/api/jobs/:jobId/records', async (request, reply) => {
  const { jobId } = request.params as { jobId: string };
  const query = request.query as Record<string, unknown>;
  const page = parsePositiveInt(query.page, 1);
  const pageSize = Math.min(parsePositiveInt(query.pageSize, 20), 200);

  const metadata = await loadJobMetadata(jobId);
  const geojson = await loadGeoJson(jobId);
  if (!metadata || !geojson) {
    return reply.code(404).send({ error: '指定されたジョブが見つかりません。' });
  }

  const features = geojson.features ?? [];
  const total = features.length;
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const sliced = features.slice(start, end);

  const items = sliced.map((feature, index) => {
    const sourceProps = (feature.properties ?? {}) as Record<string, unknown>;
    const pointLatLon = extractPointLatLon((feature as { geometry?: unknown }).geometry);
    const properties: Record<string, unknown> = {};
    for (const column of metadata.columns) {
      if (column === latitudeColumn) {
        properties[column] = pointLatLon.latitude;
        continue;
      }
      if (column === longitudeColumn) {
        properties[column] = pointLatLon.longitude;
        continue;
      }
      properties[column] = sourceProps[column] ?? null;
    }
    return {
      rowNumber: start + index + 1,
      properties
    };
  });

  return {
    jobId,
    page,
    pageSize,
    total,
    columns: metadata.columns,
    items
  };
});

server.get('/api/jobs/:jobId/download.geojson', async (request, reply) => {
  const { jobId } = request.params as { jobId: string };
  const geoJsonPath = join(jobsRoot, jobId, 'output', 'result.geojson');

  if (!(await exists(geoJsonPath))) {
    return reply.code(404).send({ error: '指定されたジョブが見つかりません。' });
  }

  const data = await readFile(geoJsonPath);
  reply.header('Content-Disposition', `attachment; filename="${jobId}.geojson"`);
  reply.type('application/geo+json');
  return reply.send(data);
});

server.get('/api/jobs/:jobId/download.csv', async (request, reply) => {
  const { jobId } = request.params as { jobId: string };
  const metadata = await loadJobMetadata(jobId);
  if (!metadata) {
    return reply.code(404).send({ error: '指定されたジョブが見つかりません。' });
  }

  let csvEncoding: CsvEncoding;
  try {
    csvEncoding = normalizeCsvEncoding((request.query as Record<string, unknown>).encoding);
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }

  const selectedColumns = parseSelectedColumns((request.query as Record<string, unknown>).columns);
  const allowedColumns = new Set(metadata.columns);
  const validatedColumns = selectedColumns ?? metadata.columns;
  if (validatedColumns.length === 0) {
    return reply.code(400).send({ error: 'CSV出力カラムを1つ以上選択してください。' });
  }

  for (const column of validatedColumns) {
    if (!allowedColumns.has(column)) {
      return reply.code(400).send({ error: `存在しないカラムが指定されました: ${column}` });
    }
  }

  const uniqueOrderedColumns = unique(validatedColumns);
  const outputCsvPath = join(jobsRoot, jobId, 'output', `result-${Date.now()}.csv`);
  const transformFields: UploadFields = {
    shapeEncoding: metadata.shapeEncoding,
    sourceEpsg: metadata.sourceEpsg
  };

  try {
    await runOgr2ogr(buildTransformArgs(metadata.shapefilePath, outputCsvPath, transformFields, metadata.hasPrj, 'CSV'));
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'CSV変換に失敗しました。' });
  }

  const dataUtf8 = await readFile(outputCsvPath, 'utf-8');
  await rm(outputCsvPath, { force: true });
  const parsed = parseCsv(dataUtf8, { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;
  const wktKey = Object.keys(parsed[0] ?? {}).find((key) => key.toUpperCase() === 'WKT');

  const outputRows = parsed.map((row) => {
    const point = parseWktPointLatLon(wktKey ? row[wktKey] : undefined);
    const output: Record<string, string | number | null> = {};
    for (const column of uniqueOrderedColumns) {
      if (column === latitudeColumn) {
        output[column] = point.latitude;
      } else if (column === longitudeColumn) {
        output[column] = point.longitude;
      } else {
        output[column] = row[column] ?? null;
      }
    }
    return output;
  });

  const outputUtf8Csv = stringifyCsv(outputRows, { header: true, columns: uniqueOrderedColumns });
  const encoded = encodeCsv(Buffer.from(outputUtf8Csv, 'utf-8'), csvEncoding);

  reply.header('Content-Disposition', `attachment; filename="${jobId}.csv"`);
  reply.type(`text/csv; charset=${encoded.charset}`);
  return reply.send(encoded.body);
});

server.get('/api/version', async () => {
  return {
    stage: 3,
    message: 'CSV column/order/encoding controls and GDAL transform endpoints are running'
  };
});

try {
  await cleanupExpiredJobs();
  const cleanupTimer = setInterval(() => {
    cleanupExpiredJobs().catch((error) => {
      server.log.warn({ err: error }, 'Periodic cleanup failed');
    });
  }, cleanupIntervalMs);
  cleanupTimer.unref();

  await server.listen({ port, host });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
