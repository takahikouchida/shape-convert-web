import { FormEvent, MouseEvent as ReactMouseEvent, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';

import { MapPanel } from './components/MapPanel';
import { RecordsPanel } from './components/RecordsPanel';
import { UploadPanel } from './components/UploadPanel';
import { useMapController } from './hooks/useMapController';
import { csvEncodingOptions } from './lib/map-style';
import type { CsvEncodingValue, GeoJsonFeatureCollection, RecordsResponse, UploadResponse } from './types';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resizingRef = useRef(false);
  const resizeStartYRef = useRef(0);
  const resizeStartHeightRef = useRef(540);

  const [file, setFile] = useState<File | null>(null);
  const [inputEncoding, setInputEncoding] = useState('AUTO');
  const [sourceEpsg, setSourceEpsg] = useState('');
  const [basemapId, setBasemapId] = useState('gsi-standard');
  const [basemapOpacity, setBasemapOpacity] = useState(1);
  const [mapHeight, setMapHeight] = useState(540);
  const [csvEncoding, setCsvEncoding] = useState<CsvEncodingValue>(csvEncodingOptions[0].value);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCsvDownloading, setIsCsvDownloading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [records, setRecords] = useState<RecordsResponse['items']>([]);
  const [recordsColumns, setRecordsColumns] = useState<string[]>([]);
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsPageSize] = useState(20);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [isRecordsLoading, setIsRecordsLoading] = useState(false);
  const [selectedFeatureProps, setSelectedFeatureProps] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);

  const { containerRef, renderAndCacheGeoJson, focusFeatureByRowNumber, resizeMap } = useMapController({
    basemapId,
    basemapOpacity,
    onFeatureSelect: setSelectedFeatureProps
  });

  const refreshRecords = async (jobId: string, page = recordsPage) => {
    setIsRecordsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/records?page=${page}&pageSize=${recordsPageSize}`);
      if (!response.ok) {
        throw new Error('レコード一覧の取得に失敗しました。');
      }
      const payload = (await response.json()) as RecordsResponse;
      setRecords(payload.items);
      setRecordsColumns(payload.columns);
      setRecordsTotal(payload.total);
      setRecordsPage(payload.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'レコード一覧の取得に失敗しました。');
    } finally {
      setIsRecordsLoading(false);
    }
  };

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) {
      setError('ZIPファイルを選択してください。');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('inputEncoding', inputEncoding);
      formData.append('sourceEpsg', sourceEpsg);

      const uploadResponse = await fetch(`${API_BASE_URL}/api/upload`, {
        method: 'POST',
        body: formData
      });
      const uploadJson = (await uploadResponse.json()) as UploadResponse & { error?: string };

      if (!uploadResponse.ok) {
        throw new Error(uploadJson.error ?? 'アップロードに失敗しました。');
      }

      const previewResponse = await fetch(`${API_BASE_URL}${uploadJson.previewUrl}`);
      if (!previewResponse.ok) {
        throw new Error('プレビューの取得に失敗しました。');
      }

      const geojson = (await previewResponse.json()) as GeoJsonFeatureCollection;
      renderAndCacheGeoJson(geojson);
      setUploadResult(uploadJson);
      setSelectedColumns(uploadJson.columns);
      await refreshRecords(uploadJson.jobId, 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '処理に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCsvDownload = async () => {
    if (!uploadResult) {
      return;
    }

    if (selectedColumns.length === 0) {
      setError('CSV出力カラムを1つ以上選択してください。');
      return;
    }

    setError('');
    setIsCsvDownloading(true);
    try {
      const params = new URLSearchParams();
      params.set('encoding', csvEncoding);
      params.set('columns', selectedColumns.join(','));

      const response = await fetch(`${API_BASE_URL}${uploadResult.downloads.csv}?${params.toString()}`);
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? 'CSVのダウンロードに失敗しました。');
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `${uploadResult.jobId}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSVのダウンロードに失敗しました。');
    } finally {
      setIsCsvDownloading(false);
    }
  };

  const startMapResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizingRef.current = true;
    resizeStartYRef.current = event.clientY;
    resizeStartHeightRef.current = mapHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!resizingRef.current) {
        return;
      }
      const delta = moveEvent.clientY - resizeStartYRef.current;
      const next = Math.min(900, Math.max(280, resizeStartHeightRef.current + delta));
      setMapHeight(next);
      resizeMap();
    };

    const onMouseUp = () => {
      resizingRef.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const toggleColumn = (column: string) => {
    setSelectedColumns((current) => (current.includes(column) ? current.filter((item) => item !== column) : [...current, column]));
  };

  const moveColumn = (column: string, direction: 'up' | 'down') => {
    setSelectedColumns((current) => {
      const index = current.indexOf(column);
      if (index < 0) {
        return current;
      }

      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= current.length) {
        return current;
      }

      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const selectAllColumns = () => {
    setSelectedColumns(uploadResult?.columns ?? []);
  };

  const clearColumns = () => {
    setSelectedColumns([]);
  };

  const recordsTotalPages = Math.max(1, Math.ceil(recordsTotal / recordsPageSize));

  return (
    <main className="min-h-screen px-2 py-3 md:px-3 md:py-4">
      <div className="grid w-full gap-4 md:grid-cols-[380px_1fr]">
        <UploadPanel
          file={file}
          inputEncoding={inputEncoding}
          sourceEpsg={sourceEpsg}
          isLoading={isLoading}
          isDragOver={isDragOver}
          error={error}
          uploadResult={uploadResult}
          fileInputRef={fileInputRef}
          onFileChange={setFile}
          onInputEncodingChange={setInputEncoding}
          onSourceEpsgChange={setSourceEpsg}
          onDragOverChange={setIsDragOver}
          onSubmit={handleUpload}
        />

        <div className="space-y-4">
          <MapPanel
            mapHeight={mapHeight}
            basemapId={basemapId}
            basemapOpacity={basemapOpacity}
            containerRef={containerRef}
            onBasemapChange={setBasemapId}
            onBasemapOpacityChange={setBasemapOpacity}
            onResizeStart={startMapResize}
          />

          <RecordsPanel
            apiBaseUrl={API_BASE_URL}
            uploadResult={uploadResult}
            records={records}
            recordsColumns={recordsColumns}
            recordsPage={recordsPage}
            recordsTotalPages={recordsTotalPages}
            recordsTotal={recordsTotal}
            isRecordsLoading={isRecordsLoading}
            csvEncoding={csvEncoding}
            selectedColumns={selectedColumns}
            selectedFeatureProps={selectedFeatureProps}
            isCsvDownloading={isCsvDownloading}
            onSelectAllColumns={selectAllColumns}
            onClearColumns={clearColumns}
            onToggleColumn={toggleColumn}
            onMoveColumn={moveColumn}
            onCsvEncodingChange={setCsvEncoding}
            onCsvDownload={handleCsvDownload}
            onFocusRow={focusFeatureByRowNumber}
            onPageChange={(nextPage) => uploadResult && refreshRecords(uploadResult.jobId, nextPage)}
          />
        </div>
      </div>
    </main>
  );
}
