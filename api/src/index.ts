import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
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
  inputEncoding: string;
  sourceEpsg: string | null;
};

type JobMetadata = {
  id: string;
  inputEncoding: string;
  sourceEpsg: string | null;
  hasPrj: boolean;
  shapefileBaseName: string;
  columns: string[];
};

function normalizeInputEncoding(raw: string | undefined): string {
  const value = (raw ?? 'AUTO').trim();
  return value === '' ? 'AUTO' : value;
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

function buildTransformArgs(inputShpPath: string, outputPath: string, fields: UploadFields, hasPrj: boolean, format: 'GeoJSON' | 'CSV'): string[] {
  const args = ['-f', format, outputPath, inputShpPath];

  if (fields.inputEncoding !== 'AUTO') {
    args.unshift(fields.inputEncoding);
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
    args.push('-lco', 'GEOMETRY=AS_WKT');
  }

  return args;
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
    const shapefiles = extractedFiles.filter((file) => extname(file).toLowerCase() === '.shp');

    if (shapefiles.length === 0) {
      return reply.code(400).send({ error: 'ZIP内にShapefile（.shp）が見つかりません。' });
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

    const fields: UploadFields = {
      inputEncoding,
      sourceEpsg
    };

    const geoJsonPath = join(outputDir, 'result.geojson');
    const csvPath = join(outputDir, 'result.csv');

    await runOgr2ogr(buildTransformArgs(selectedShpPath, geoJsonPath, fields, hasPrj, 'GeoJSON'));
    await runOgr2ogr(buildTransformArgs(selectedShpPath, csvPath, fields, hasPrj, 'CSV'));

    const columns = await loadColumnsFromGeoJson(geoJsonPath);

    const metadata: JobMetadata = {
      id: jobId,
      inputEncoding,
      sourceEpsg,
      hasPrj,
      shapefileBaseName: basename(shpBasePath),
      columns
    };
    await writeFile(join(jobDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');

    return reply.send({
      jobId,
      hasPrj,
      selectedShapefile: basename(selectedShpPath),
      sourceEpsg,
      inputEncoding,
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
  const geoJsonPath = join(jobsRoot, jobId, 'output', 'result.geojson');

  if (!(await exists(geoJsonPath))) {
    return reply.code(404).send({ error: '指定されたジョブが見つかりません。' });
  }

  const geojson = await readFile(geoJsonPath, 'utf-8');
  reply.type('application/geo+json; charset=utf-8');
  return reply.send(geojson);
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
  const csvPath = join(jobsRoot, jobId, 'output', 'result.csv');

  if (!(await exists(csvPath))) {
    return reply.code(404).send({ error: '指定されたジョブが見つかりません。' });
  }

  const data = await readFile(csvPath);
  reply.header('Content-Disposition', `attachment; filename="${jobId}.csv"`);
  reply.type('text/csv; charset=utf-8');
  return reply.send(data);
});

server.get('/api/version', async () => {
  return {
    stage: 2,
    message: 'Upload and GDAL transform endpoints are running'
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
