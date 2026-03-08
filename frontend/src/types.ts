export type UploadResponse = {
  jobId: string;
  columns: string[];
  requestedInputEncoding: string;
  inputEncoding: string;
  detectedCpg: string | null;
  previewUrl: string;
  downloads: {
    geojson: string;
    csv: string;
  };
  hasPrj: boolean;
  sourceEpsg: string | null;
};

export type RecordsResponse = {
  jobId: string;
  page: number;
  pageSize: number;
  total: number;
  columns: string[];
  items: Array<{
    rowNumber: number;
    properties: Record<string, unknown>;
  }>;
};

export type GeoJsonFeatureCollection = GeoJSON.FeatureCollection;

export type BasemapOption = {
  id: string;
  label: string;
  category: 'map' | 'photo';
  tiles?: string[];
  attribution?: string;
};

export type CsvEncodingValue = 'utf8' | 'utf8bom' | 'cp932';
