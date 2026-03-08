import type { StyleSpecification } from 'maplibre-gl';

import type { BasemapOption } from '../types';

export const basemapOptions: BasemapOption[] = [
  {
    id: 'none',
    label: '背景なし',
    category: 'map'
  },
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

export const encodingOptions = ['AUTO', 'UTF-8', 'CP932', 'EUC-JP', 'ISO-8859-1'];
export const csvEncodingOptions = [
  { value: 'utf8', label: 'UTF-8' },
  { value: 'utf8bom', label: 'UTF-8 (BOM)' },
  { value: 'cp932', label: 'CP932 (Shift_JIS)' }
] as const;
export const commonEpsgTags = ['4326', '3857', '4612', '6668', '6677'];

export function createRasterStyle(option: BasemapOption, opacity: number): StyleSpecification {
  if (option.id === 'none') {
    return {
      version: 8,
      sources: {},
      layers: []
    };
  }

  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        tiles: option.tiles ?? [],
        tileSize: 256,
        attribution: option.attribution ?? ''
      }
    },
    layers: [
      {
        id: 'basemap-layer',
        type: 'raster',
        source: 'basemap',
        paint: {
          'raster-opacity': opacity
        }
      }
    ]
  };
}
