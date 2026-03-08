import { MouseEvent as ReactMouseEvent, RefObject } from 'react';

import { Card, CardContent } from './ui/card';
import { Label } from './ui/label';
import { basemapOptions } from '../lib/map-style';

type Props = {
  mapHeight: number;
  basemapId: string;
  basemapOpacity: number;
  containerRef: RefObject<HTMLDivElement | null>;
  onBasemapChange: (value: string) => void;
  onBasemapOpacityChange: (value: number) => void;
  onResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void;
};

export function MapPanel({
  mapHeight,
  basemapId,
  basemapOpacity,
  containerRef,
  onBasemapChange,
  onBasemapOpacityChange,
  onResizeStart
}: Props) {
  return (
    <>
      <Card className="overflow-hidden border-sky-200/80 bg-white/85 backdrop-blur">
        <CardContent className="p-2">
          <div className="relative w-full overflow-hidden rounded-lg border" style={{ height: `${mapHeight}px` }}>
            <div ref={containerRef} className="h-full w-full" />
            <div className="absolute left-2 top-2 z-10 w-64 rounded-md border bg-white/90 p-2 shadow">
              <Label htmlFor="map-basemap" className="text-xs">
                背景地図
              </Label>
              <select
                id="map-basemap"
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                value={basemapId}
                onChange={(event) => onBasemapChange(event.target.value)}
              >
                {basemapOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.category === 'photo' ? '写真' : '地図'} / {option.label}
                  </option>
                ))}
              </select>

              <Label htmlFor="map-opacity" className="mt-2 block text-xs">
                背景透明度: {Math.round(basemapOpacity * 100)}%
              </Label>
              <input
                id="map-opacity"
                type="range"
                min={0}
                max={100}
                step={5}
                className="mt-1 w-full"
                value={Math.round(basemapOpacity * 100)}
                onChange={(event) => onBasemapOpacityChange(Number(event.target.value) / 100)}
                disabled={basemapId === 'none'}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div
        role="separator"
        aria-orientation="horizontal"
        className="group flex h-4 cursor-row-resize items-center justify-center"
        onMouseDown={onResizeStart}
      >
        <div className="h-1 w-24 rounded-full bg-slate-300 transition-colors group-hover:bg-slate-500" />
      </div>
    </>
  );
}
