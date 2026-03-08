import { FileUp, Loader2, Map as MapIcon, UploadCloud } from 'lucide-react';
import { ChangeEvent, DragEvent, FormEvent, RefObject } from 'react';

import { Alert } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { commonEpsgTags, encodingOptions } from '../lib/map-style';
import type { UploadResponse } from '../types';

type Props = {
  file: File | null;
  inputEncoding: string;
  sourceEpsg: string;
  isLoading: boolean;
  isDragOver: boolean;
  error: string;
  uploadResult: UploadResponse | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileChange: (file: File | null) => void;
  onInputEncodingChange: (value: string) => void;
  onSourceEpsgChange: (value: string) => void;
  onDragOverChange: (isOver: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function UploadPanel({
  file,
  inputEncoding,
  sourceEpsg,
  isLoading,
  isDragOver,
  error,
  uploadResult,
  fileInputRef,
  onFileChange,
  onInputEncodingChange,
  onSourceEpsgChange,
  onDragOverChange,
  onSubmit
}: Props) {
  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    onFileChange(event.target.files?.[0] ?? null);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    onDragOverChange(false);
    onFileChange(event.dataTransfer.files?.[0] ?? null);
  };

  return (
    <Card className="border-sky-200/80 bg-white/90 backdrop-blur">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <FileUp className="h-5 w-5 text-sky-700" />
          Shape Convert
        </CardTitle>
        <CardDescription>ZIPアップロードしてGDALでGeoJSON/CSVへ変換します。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="zip-file">Shapefile ZIP</Label>
            <input id="zip-file" ref={fileInputRef} type="file" accept=".zip" className="hidden" onChange={handleFileInput} />
            <div className="flex gap-2">
              <Input value={file?.name ?? ''} readOnly placeholder="ZIPファイルを選択してください" className="flex-1" />
              <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                選択
              </Button>
            </div>
            <div
              className={`rounded-md border-2 border-dashed p-3 text-sm transition-colors ${isDragOver ? 'border-sky-500 bg-sky-50' : 'border-slate-300 bg-slate-50'}`}
              onDragOver={(event) => {
                event.preventDefault();
                onDragOverChange(true);
              }}
              onDragLeave={() => onDragOverChange(false)}
              onDrop={handleDrop}
            >
              <div className="flex items-center gap-2 text-muted-foreground">
                <UploadCloud className="h-4 w-4" />
                <span>ZIPをここにドラッグ＆ドロップできます</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="input-encoding">入力文字コード</Label>
            <select
              id="input-encoding"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={inputEncoding}
              onChange={(event) => onInputEncodingChange(event.target.value)}
            >
              {encodingOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="source-epsg">EPSGコード（.prjなし時必須）</Label>
            <Input id="source-epsg" type="text" placeholder="例: 6677 / 4326" value={sourceEpsg} onChange={(event) => onSourceEpsgChange(event.target.value)} />
            <div className="flex flex-wrap gap-2">
              {commonEpsgTags.map((epsg) => (
                <Button key={epsg} type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onSourceEpsgChange(epsg)}>
                  EPSG:{epsg}
                </Button>
              ))}
            </div>
          </div>

          <Button className="w-full" type="submit" disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapIcon className="h-4 w-4" />}
            {isLoading ? '処理中...' : 'アップロードして可視化'}
          </Button>
        </form>

        {error && <Alert>{error}</Alert>}

        {uploadResult && (
          <div className="space-y-2 rounded-lg border bg-muted/60 p-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">Job: {uploadResult.jobId.slice(0, 8)}</Badge>
              <Badge variant="outline">.prj: {uploadResult.hasPrj ? 'あり' : 'なし'}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">入力EPSG: {uploadResult.sourceEpsg ?? '(prjから解決)'}</p>
            <p className="text-sm text-muted-foreground">
              入力文字コード: {uploadResult.requestedInputEncoding} {'->'} 実効: {uploadResult.inputEncoding}
            </p>
            {uploadResult.detectedCpg && <p className="text-sm text-muted-foreground">.cpg検出: {uploadResult.detectedCpg}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
