import { ArrowDown, ArrowUp, Download, Loader2 } from 'lucide-react';

import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader } from './ui/card';
import { Label } from './ui/label';
import { csvEncodingOptions } from '../lib/map-style';
import type { CsvEncodingValue, RecordsResponse, UploadResponse } from '../types';

type Props = {
  apiBaseUrl: string;
  uploadResult: UploadResponse | null;
  records: RecordsResponse['items'];
  recordsColumns: string[];
  recordsPage: number;
  recordsTotalPages: number;
  recordsTotal: number;
  isRecordsLoading: boolean;
  csvEncoding: CsvEncodingValue;
  selectedColumns: string[];
  selectedFeatureProps: Record<string, unknown> | null;
  isCsvDownloading: boolean;
  onSelectAllColumns: () => void;
  onClearColumns: () => void;
  onToggleColumn: (column: string) => void;
  onMoveColumn: (column: string, direction: 'up' | 'down') => void;
  onCsvEncodingChange: (value: CsvEncodingValue) => void;
  onCsvDownload: () => void;
  onFocusRow: (rowNumber: number) => void;
  onPageChange: (nextPage: number) => void;
};

export function RecordsPanel({
  apiBaseUrl,
  uploadResult,
  records,
  recordsColumns,
  recordsPage,
  recordsTotalPages,
  recordsTotal,
  isRecordsLoading,
  csvEncoding,
  selectedColumns,
  selectedFeatureProps,
  isCsvDownloading,
  onSelectAllColumns,
  onClearColumns,
  onToggleColumn,
  onMoveColumn,
  onCsvEncodingChange,
  onCsvDownload,
  onFocusRow,
  onPageChange
}: Props) {
  return (
    <Card className="border-sky-200/80 bg-white/90 backdrop-blur">
      <CardHeader className="pb-3">
        <CardDescription>現在アップロード中のシェープの属性レコードを表示</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!uploadResult && <p className="text-sm text-muted-foreground">アップロード後にレコード一覧が表示されます。</p>}
        {uploadResult && (
          <div className="space-y-2">
            <div className="space-y-2 rounded-md border bg-white/80 p-3">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">出力設定（ヘッダーでカラム選択・順序変更）</Label>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={onSelectAllColumns}>
                    全選択
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={onClearColumns}>
                    解除
                  </Button>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button asChild size="sm" variant="outline">
                  <a href={`${apiBaseUrl}${uploadResult.downloads.geojson}`} target="_blank" rel="noreferrer">
                    <Download className="h-4 w-4" />
                    GeoJSON
                  </a>
                </Button>
                <div className="rounded-md border bg-background/70 px-2 py-1">
                  <div className="mb-1 text-[11px] font-semibold text-muted-foreground">CSV</div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="csv-encoding" className="text-xs whitespace-nowrap">
                      文字コード
                    </Label>
                    <select
                      id="csv-encoding"
                      className="flex h-9 rounded-md border border-input bg-background px-2 py-1 text-sm"
                      value={csvEncoding}
                      onChange={(event) => onCsvEncodingChange(event.target.value as CsvEncodingValue)}
                    >
                      {csvEncodingOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" variant="outline" onClick={onCsvDownload} disabled={isCsvDownloading || selectedColumns.length === 0}>
                      {isCsvDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      DL
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="max-h-80 overflow-auto rounded border">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="border px-2 py-1 text-left">#</th>
                    {recordsColumns.map((column) => (
                      <th key={column} className="border px-2 py-1 text-left">
                        <div className="space-y-1">
                          <label className="flex items-center gap-1">
                            <input type="checkbox" checked={selectedColumns.includes(column)} onChange={() => onToggleColumn(column)} />
                            <span>{column}</span>
                            {selectedColumns.includes(column) && <span className="rounded bg-sky-100 px-1 text-[10px] text-sky-700">#{selectedColumns.indexOf(column) + 1}</span>}
                          </label>
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1"
                              onClick={() => onMoveColumn(column, 'up')}
                              disabled={!selectedColumns.includes(column)}
                            >
                              <ArrowUp className="h-3 w-3" />
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1"
                              onClick={() => onMoveColumn(column, 'down')}
                              disabled={!selectedColumns.includes(column)}
                            >
                              <ArrowDown className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.map((row) => {
                    const isSelected =
                      selectedFeatureProps !== null &&
                      recordsColumns.every((column) => String(row.properties[column] ?? '') === String(selectedFeatureProps[column] ?? ''));
                    return (
                      <tr key={row.rowNumber} className={isSelected ? 'bg-amber-100/60' : undefined}>
                        <td className="border px-2 py-1">
                          <button type="button" className="font-semibold text-sky-700 underline-offset-2 hover:underline" onClick={() => onFocusRow(row.rowNumber)}>
                            {row.rowNumber}
                          </button>
                        </td>
                        {recordsColumns.map((column) => (
                          <td key={`${row.rowNumber}-${column}`} className="border px-2 py-1">
                            {row.properties[column] === null || row.properties[column] === undefined ? '' : String(row.properties[column])}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {records.length === 0 && (
                    <tr>
                      <td className="border px-2 py-3 text-muted-foreground" colSpan={Math.max(1, recordsColumns.length + 1)}>
                        {isRecordsLoading ? '読み込み中...' : '表示できるレコードがありません。'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                page {recordsPage} / {recordsTotalPages} (total {recordsTotal})
              </p>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => onPageChange(recordsPage - 1)} disabled={recordsPage <= 1 || isRecordsLoading}>
                  前へ
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onPageChange(recordsPage + 1)}
                  disabled={recordsPage >= recordsTotalPages || isRecordsLoading}
                >
                  次へ
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
