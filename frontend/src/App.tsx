import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { LngLatBounds } from 'maplibre-gl';
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import { Download, FileUp, Loader2, Map as MapIcon } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';

import { Alert } from './components/ui/alert';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';

type UploadResponse = {
  jobId: string;
  columns: string[];
  previewUrl: string;
  downloads: {
    geojson: string;
    csv: string;
  };
  hasPrj: boolean;
  sourceEpsg: string | null;
};

type GeoJsonFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: {
      type: string;
      coordinates?: unknown;
    } | null;
    properties: Record<string, unknown>;
  }>;
};

type BasemapOption = {
  id: string;
  label: string;
  category: 'map' | 'photo';
  tiles: string[];
  attribution: string;
};

const encodingOptions = ['AUTO', 'UTF-8', 'CP932', 'EUC-JP', 'ISO-8859-1'];

const basemapOptions: BasemapOption[] = [
  {
    id: 'gsi-standard',
    label: '地理院地図（標準）',
    category: 'map',
    tiles: ['https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'],
    attribution: '地理院タイル'
  },
  {
    id: 'gsi-photo',
    label: '地理院写真（シームレス）',
    category: 'photo',
    tiles: ['https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'],
    attribution: '地理院タイル'
  },
  {
    id: 'osm',
    label: 'OpenStreetMap',
    category: 'map',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: '© OpenStreetMap contributors'
  },
  {
    id: 'opentopo',
    label: 'OpenTopoMap',
    category: 'map',
    tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
    attribution: '© OpenTopoMap, © OpenStreetMap contributors'
  },
  {
    id: 'esri-world-imagery',
    label: 'Esri World Imagery',
    category: 'photo',
    tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Tiles © Esri'
  },
  {
    id: 'usgs-ortho',
    label: 'USGS US Imagery',
    category: 'photo',
    tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'U.S. Geological Survey'
  }
];

function createRasterStyle(option: BasemapOption): StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        tiles: option.tiles,
        tileSize: 256,
        attribution: option.attribution
      }
    },
    layers: [
      {
        id: 'basemap-layer',
        type: 'raster',
        source: 'basemap'
      }
    ]
  };
}

export default function App() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const geoJsonCacheRef = useRef<GeoJsonFeatureCollection | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [inputEncoding, setInputEncoding] = useState('AUTO');
  const [sourceEpsg, setSourceEpsg] = useState('');
  const [basemapId, setBasemapId] = useState('osm');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);

  const currentBasemap = useMemo(() => basemapOptions.find((option) => option.id === basemapId) ?? basemapOptions[0], [basemapId]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: createRasterStyle(currentBasemap),
      center: [139.767, 35.681],
      zoom: 9
    });

    mapRef.current = map;

    return () => {
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    map.setStyle(createRasterStyle(currentBasemap));
    map.once('load', () => {
      if (geoJsonCacheRef.current) {
        renderGeoJson(geoJsonCacheRef.current);
      }
    });
  }, [currentBasemap]);

  const renderGeoJson = (geojson: GeoJsonFeatureCollection) => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const drawToMap = () => {
      const existingSource = map.getSource('shape-source');
      if (existingSource) {
        (existingSource as GeoJSONSource).setData(geojson);
      } else {
        map.addSource('shape-source', {
          type: 'geojson',
          data: geojson
        });
      }

      if (!map.getLayer('shape-fill')) {
        map.addLayer({
          id: 'shape-fill',
          type: 'fill',
          source: 'shape-source',
          paint: {
            'fill-color': '#0369a1',
            'fill-opacity': 0.25
          },
          filter: ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']]
        });
      }

      if (!map.getLayer('shape-line')) {
        map.addLayer({
          id: 'shape-line',
          type: 'line',
          source: 'shape-source',
          paint: {
            'line-color': '#0f172a',
            'line-width': 2
          },
          filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']]
        });
      }

      if (!map.getLayer('shape-point')) {
        map.addLayer({
          id: 'shape-point',
          type: 'circle',
          source: 'shape-source',
          paint: {
            'circle-color': '#b91c1c',
            'circle-radius': 4,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1
          },
          filter: ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']]
        });
      }

      const bounds = new LngLatBounds();
      for (const feature of geojson.features) {
        const geometry = feature.geometry;
        if (!geometry) {
          continue;
        }

        const extendCoords = (coords: unknown): void => {
          if (Array.isArray(coords) && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
            bounds.extend([coords[0], coords[1]]);
            return;
          }

          if (Array.isArray(coords)) {
            for (const child of coords) {
              extendCoords(child);
            }
          }
        };

        extendCoords(geometry.coordinates as unknown);
      }

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 40, duration: 0 });
      }
    };

    if (map.isStyleLoaded()) {
      drawToMap();
    } else {
      map.once('load', drawToMap);
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
      geoJsonCacheRef.current = geojson;
      renderGeoJson(geojson);
      setUploadResult(uploadJson);
    } catch (err) {
      setError(err instanceof Error ? err.message : '処理に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen px-4 py-6 md:px-8">
      <div className="mx-auto grid w-full max-w-[1400px] gap-4 md:grid-cols-[380px_1fr]">
        <Card className="border-sky-200/80 bg-white/90 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <FileUp className="h-5 w-5 text-sky-700" />
              Shape Convert
            </CardTitle>
            <CardDescription>ZIPアップロードしてGDALでGeoJSON/CSVへ変換します。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="space-y-4" onSubmit={handleUpload}>
              <div className="space-y-2">
                <Label htmlFor="zip-file">Shapefile ZIP</Label>
                <Input id="zip-file" type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="input-encoding">入力文字コード</Label>
                <select
                  id="input-encoding"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={inputEncoding}
                  onChange={(e) => setInputEncoding(e.target.value)}
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
                <Input id="source-epsg" type="text" placeholder="例: 6677 / 4326" value={sourceEpsg} onChange={(e) => setSourceEpsg(e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="basemap">背景地図</Label>
                <select
                  id="basemap"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={basemapId}
                  onChange={(e) => setBasemapId(e.target.value)}
                >
                  {basemapOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.category === 'photo' ? '写真' : '地図'} / {option.label}
                    </option>
                  ))}
                </select>
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
                <p className="text-sm text-muted-foreground">カラム: {uploadResult.columns.join(', ') || '(なし)'}</p>
                <div className="flex gap-2">
                  <Button asChild size="sm" variant="outline">
                    <a href={`${API_BASE_URL}${uploadResult.downloads.geojson}`} target="_blank" rel="noreferrer">
                      <Download className="h-4 w-4" />
                      GeoJSON
                    </a>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a href={`${API_BASE_URL}${uploadResult.downloads.csv}`} target="_blank" rel="noreferrer">
                      <Download className="h-4 w-4" />
                      CSV
                    </a>
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-sky-200/80 bg-white/85 backdrop-blur">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Map Preview</CardTitle>
            <CardDescription>{currentBasemap.label} を表示中</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div ref={containerRef} className="h-[68vh] min-h-[440px] w-full overflow-hidden rounded-lg border" />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
