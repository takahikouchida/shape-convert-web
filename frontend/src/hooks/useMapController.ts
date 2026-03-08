import { useEffect, useMemo, useRef } from 'react';
import maplibregl, { LngLatBounds } from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';

import { basemapOptions, createRasterStyle } from '../lib/map-style';
import type { BasemapOption, GeoJsonFeatureCollection } from '../types';

type Params = {
  basemapId: string;
  basemapOpacity: number;
  onFeatureSelect: (props: Record<string, unknown> | null) => void;
};

export function useMapController({ basemapId, basemapOpacity, onFeatureSelect }: Params) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const geoJsonCacheRef = useRef<GeoJsonFeatureCollection | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  const currentBasemap = useMemo<BasemapOption>(
    () => basemapOptions.find((option) => option.id === basemapId) ?? basemapOptions[0],
    [basemapId]
  );

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: createRasterStyle(currentBasemap, basemapOpacity),
      center: [139.767, 35.681],
      zoom: 9
    });

    mapRef.current = map;

    return () => {
      popupRef.current?.remove();
      map.remove();
    };
  }, []);

  const renderGeoJson = (geojson: GeoJsonFeatureCollection, shouldFitBounds = true) => {
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

      const clickLayers = ['shape-fill', 'shape-line', 'shape-point'] as const;
      const clickHandler = (event: maplibregl.MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature) {
          return;
        }

        const props = (feature.properties ?? {}) as Record<string, unknown>;
        onFeatureSelect(props);

        const root = document.createElement('div');
        root.style.fontSize = '12px';
        root.style.maxWidth = '320px';
        root.style.maxHeight = '220px';
        root.style.overflow = 'auto';

        const title = document.createElement('div');
        title.textContent = '属性';
        title.style.fontWeight = '700';
        title.style.marginBottom = '6px';
        root.appendChild(title);

        for (const [key, value] of Object.entries(props)) {
          const row = document.createElement('div');
          row.style.marginBottom = '2px';
          row.textContent = `${key}: ${value ?? ''}`;
          root.appendChild(row);
        }

        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ closeButton: true, closeOnClick: true }).setLngLat(event.lngLat).setDOMContent(root).addTo(map);
      };

      const cursorPointer = () => {
        map.getCanvas().style.cursor = 'pointer';
      };
      const cursorDefault = () => {
        map.getCanvas().style.cursor = '';
      };

      for (const layerId of clickLayers) {
        map.off('click', layerId, clickHandler);
        map.off('mouseenter', layerId, cursorPointer);
        map.off('mouseleave', layerId, cursorDefault);
        map.on('click', layerId, clickHandler);
        map.on('mouseenter', layerId, cursorPointer);
        map.on('mouseleave', layerId, cursorDefault);
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

        if (geometry.type === 'GeometryCollection') {
          for (const child of geometry.geometries) {
            if ('coordinates' in child) {
              extendCoords(child.coordinates as unknown);
            }
          }
        } else if ('coordinates' in geometry) {
          extendCoords(geometry.coordinates as unknown);
        }
      }

      if (shouldFitBounds && !bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 40, duration: 0 });
      }
    };

    if (map.isStyleLoaded()) {
      drawToMap();
    } else {
      map.once('idle', drawToMap);
    }
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    map.setStyle(createRasterStyle(currentBasemap, basemapOpacity));
    const redraw = () => {
      if (geoJsonCacheRef.current) {
        renderGeoJson(geoJsonCacheRef.current, false);
      }
    };
    map.once('idle', redraw);
  }, [currentBasemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || currentBasemap.id === 'none' || !map.getLayer('basemap-layer')) {
      return;
    }
    map.setPaintProperty('basemap-layer', 'raster-opacity', basemapOpacity);
  }, [basemapOpacity, currentBasemap.id]);

  const renderAndCacheGeoJson = (geojson: GeoJsonFeatureCollection, shouldFitBounds = true) => {
    geoJsonCacheRef.current = geojson;
    renderGeoJson(geojson, shouldFitBounds);
  };

  const focusFeatureByRowNumber = (rowNumber: number) => {
    const map = mapRef.current;
    const geojson = geoJsonCacheRef.current;
    if (!map || !geojson) {
      return;
    }

    const target = (geojson.features ?? [])[rowNumber - 1];
    if (!target || !target.geometry) {
      return;
    }

    const bounds = new LngLatBounds();
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

    const geometry = target.geometry;
    if (geometry.type === 'GeometryCollection') {
      for (const child of geometry.geometries) {
        if ('coordinates' in child) {
          extendCoords(child.coordinates as unknown);
        }
      }
    } else if ('coordinates' in geometry) {
      extendCoords(geometry.coordinates as unknown);
    }

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 80, duration: 600 });
    }
  };

  const resizeMap = () => {
    mapRef.current?.resize();
  };

  return {
    containerRef,
    renderAndCacheGeoJson,
    focusFeatureByRowNumber,
    resizeMap
  };
}
