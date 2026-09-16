'use client';

import type { WhiteboardMode, WhiteboardStrokePayload, WhiteboardTool } from '@orbit/shared';
import {
  Circle as CircleIcon,
  Download,
  Eraser,
  Minus,
  Pencil,
  Square,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/primitives';
import { meetingClient } from '@/lib/meeting-client';
import { selectIsHost, useRoomStore } from '@/lib/room-store';

/**
 * Collaborative whiteboard.
 *
 * Strokes, not pixels. Each drawing operation travels as a tool, a colour and
 * a list of points — a few hundred bytes — instead of a bitmap per frame,
 * which is what makes the board usable alongside a video call rather than in
 * competition with it. The canvas is repainted from the stroke list, so a late
 * joiner replays the same rows and sees the identical board.
 *
 * Coordinates are normalised to 0–1, so a line drawn on a phone lands in the
 * same relative place on a widescreen monitor.
 */

const COLORS = ['#f8fafc', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];
const WIDTHS = [2, 4, 8, 16];

const TOOLS: { id: WhiteboardTool; label: string; icon: typeof Pencil }[] = [
  { id: 'pen', label: 'Pen', icon: Pencil },
  { id: 'line', label: 'Line', icon: Minus },
  { id: 'rect', label: 'Rectangle', icon: Square },
  { id: 'ellipse', label: 'Ellipse', icon: CircleIcon },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'eraser', label: 'Eraser', icon: Eraser },
];

export function WhiteboardPanel() {
  const isHost = useRoomStore(selectIsHost);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [strokes, setStrokes] = useState<WhiteboardStrokePayload[]>([]);
  const [canDraw, setCanDraw] = useState(false);
  const [mode, setMode] = useState<WhiteboardMode>('EVERYONE');
  const [tool, setTool] = useState<WhiteboardTool>('pen');
  const [color, setColor] = useState(COLORS[1]!);
  const [width, setWidth] = useState(4);

  /** The stroke being drawn right now, before it is committed. */
  const draftRef = useRef<number[] | null>(null);
  const [draftTick, setDraftTick] = useState(0);

  // ---- load and subscribe ----

  useEffect(() => {
    let cancelled = false;

    void meetingClient.loadWhiteboard().then((state) => {
      if (cancelled || !state) return;
      setStrokes(state.strokes);
      setCanDraw(state.canDraw);
      setMode(state.mode);
    });

    const off = meetingClient.onWhiteboard({
      stroke: (stroke) => setStrokes((current) => [...current, stroke]),
      undo: ({ strokeId }) =>
        setStrokes((current) => current.filter((stroke) => stroke.id !== strokeId)),
      cleared: () => setStrokes([]),
      permissions: (payload) => {
        setCanDraw(payload.canDraw);
        setMode(payload.mode);
      },
    });

    return () => {
      cancelled = true;
      off();
    };
  }, []);

  // ---- painting ----

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const { width: w, height: h } = canvas;
    context.clearRect(0, 0, w, h);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    const drawOne = (stroke: {
      tool: string;
      color: string;
      width: number;
      points: number[];
      text?: string | null;
    }) => {
      const points = stroke.points;
      if (points.length < 2) return;

      // The eraser paints the board's own background rather than compositing,
      // which keeps the result identical when the board is exported.
      context.strokeStyle = stroke.tool === 'eraser' ? '#0b1120' : stroke.color;
      context.fillStyle = stroke.tool === 'eraser' ? '#0b1120' : stroke.color;
      context.lineWidth = stroke.width;

      const x = (i: number) => points[i]! * w;
      const y = (i: number) => points[i]! * h;

      if (stroke.tool === 'text' && stroke.text) {
        context.font = `${Math.max(12, stroke.width * 4)}px ui-sans-serif, system-ui, sans-serif`;
        context.textBaseline = 'top';
        // Drawn as canvas text, so markup in a label is never interpreted.
        context.fillText(stroke.text, x(0), y(1));
        return;
      }

      context.beginPath();

      if (stroke.tool === 'rect' && points.length >= 4) {
        context.rect(x(0), y(1), x(2) - x(0), y(3) - y(1));
      } else if (stroke.tool === 'ellipse' && points.length >= 4) {
        const cx = (x(0) + x(2)) / 2;
        const cy = (y(1) + y(3)) / 2;
        context.ellipse(cx, cy, Math.abs(x(2) - x(0)) / 2, Math.abs(y(3) - y(1)) / 2, 0, 0, Math.PI * 2);
      } else if (stroke.tool === 'line' && points.length >= 4) {
        context.moveTo(x(0), y(1));
        context.lineTo(x(2), y(3));
      } else {
        context.moveTo(x(0), y(1));
        for (let i = 2; i < points.length - 1; i += 2) context.lineTo(x(i), y(i + 1));
      }

      context.stroke();
    };

    for (const stroke of strokes) drawOne(stroke);

    // The in-progress stroke is painted last so it sits on top.
    if (draftRef.current) {
      drawOne({ tool, color, width, points: draftRef.current });
    }
  }, [strokes, tool, color, width]);

  useEffect(() => {
    paint();
  }, [paint, draftTick]);

  // Keep the backing store matched to the element's real pixel size, so lines
  // stay crisp on high-density screens and after a resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      paint();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [paint]);

  // ---- pointer handling ----

  function toBoard(event: React.PointerEvent): [number, number] {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
  }

  function onPointerDown(event: React.PointerEvent) {
    if (!canDraw) return;
    event.currentTarget.setPointerCapture(event.pointerId);

    const [x, y] = toBoard(event);

    if (tool === 'text') {
      const text = window.prompt('Text to place on the board');
      if (text?.trim()) {
        void commit([x, y], text.trim());
      }
      return;
    }

    draftRef.current = [x, y];
    setDraftTick((tick) => tick + 1);
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!draftRef.current) return;
    const [x, y] = toBoard(event);

    if (tool === 'pen' || tool === 'eraser') {
      // Skip points that barely moved: a freehand line does not need a sample
      // every pixel, and dropping them keeps strokes small on the wire.
      const points = draftRef.current;
      const lastX = points[points.length - 2]!;
      const lastY = points[points.length - 1]!;
      if (Math.abs(x - lastX) < 0.002 && Math.abs(y - lastY) < 0.002) return;
      points.push(x, y);
    } else {
      // Shapes keep only their start and current corner.
      draftRef.current = [draftRef.current[0]!, draftRef.current[1]!, x, y];
    }

    setDraftTick((tick) => tick + 1);
  }

  async function onPointerUp() {
    const points = draftRef.current;
    draftRef.current = null;
    setDraftTick((tick) => tick + 1);
    if (!points || points.length < 4) return;
    await commit(points);
  }

  async function commit(points: number[], text?: string) {
    // Drawn locally straight away so the line feels immediate, then confirmed
    // by the server. A refusal removes it again rather than leaving a stroke
    // that nobody else can see.
    const optimistic: WhiteboardStrokePayload = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      authorIdentity: 'me',
      authorName: 'You',
      tool,
      color,
      width,
      points,
      text: text ?? null,
      seq: Number.MAX_SAFE_INTEGER,
    };
    setStrokes((current) => [...current, optimistic]);

    const result = await meetingClient.drawStroke({
      tool,
      color,
      width,
      points,
      text: text ?? null,
    });

    setStrokes((current) => {
      const without = current.filter((stroke) => stroke.id !== optimistic.id);
      return result.ok && result.data ? [...without, result.data] : without;
    });
  }

  function exportPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Composite onto an opaque background: a transparent PNG of white lines
    // looks empty in most viewers.
    const output = document.createElement('canvas');
    output.width = canvas.width;
    output.height = canvas.height;
    const context = output.getContext('2d');
    if (!context) return;

    context.fillStyle = '#0b1120';
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(canvas, 0, 0);

    output.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `whiteboard-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  return (
    <div className="flex h-full flex-col">
      {/* ---- toolbar ---- */}
      <div className="shrink-0 space-y-2 border-b border-white/10 p-3">
        {!canDraw && (
          <p className="rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px] text-ink-400">
            {mode === 'HOSTS_ONLY'
              ? 'Only hosts can draw on this board.'
              : 'The host has not given you drawing access.'}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1">
          {TOOLS.map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTool(entry.id)}
                disabled={!canDraw}
                aria-pressed={tool === entry.id}
                aria-label={entry.label}
                title={entry.label}
                className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors disabled:opacity-40 ${
                  tool === entry.id ? 'bg-brand-600 text-white' : 'bg-white/10 text-ink-300 hover:bg-white/20'
                }`}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}

          <span className="mx-1 h-6 w-px bg-white/10" aria-hidden="true" />

          <button
            type="button"
            onClick={() => void meetingClient.undoWhiteboard()}
            disabled={!canDraw}
            aria-label="Undo my last stroke"
            title="Undo my last stroke"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-ink-300 transition-colors hover:bg-white/20 disabled:opacity-40"
          >
            <Undo2 className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={exportPng}
            aria-label="Export board as PNG"
            title="Export as PNG"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-ink-300 transition-colors hover:bg-white/20"
          >
            <Download className="h-4 w-4" />
          </button>

          {isHost && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Clear the board for everyone?')) {
                  void meetingClient.clearWhiteboard();
                }
              }}
              aria-label="Clear the board for everyone"
              title="Clear for everyone"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-danger-400 transition-colors hover:bg-danger-500/20"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="group" aria-label="Colour">
            {COLORS.map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setColor(entry)}
                disabled={!canDraw}
                aria-label={`Colour ${entry}`}
                aria-pressed={color === entry}
                style={{ backgroundColor: entry }}
                className={`h-6 w-6 rounded-full transition-transform disabled:opacity-40 ${
                  color === entry ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-ink-900' : ''
                }`}
              />
            ))}
          </div>

          <div className="flex gap-1" role="group" aria-label="Line width">
            {WIDTHS.map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setWidth(entry)}
                disabled={!canDraw}
                aria-label={`Width ${entry}`}
                aria-pressed={width === entry}
                className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:opacity-40 ${
                  width === entry ? 'bg-brand-600' : 'bg-white/10 hover:bg-white/20'
                }`}
              >
                <span
                  className="rounded-full bg-current text-ink-100"
                  style={{ width: entry + 2, height: entry + 2 }}
                />
              </button>
            ))}
          </div>
        </div>

        {isHost && (
          <div>
            <label htmlFor="wb-mode" className="text-[11px] font-medium text-ink-400">
              Who can draw
            </label>
            <select
              id="wb-mode"
              value={mode}
              onChange={(event) => void meetingClient.setWhiteboardMode(event.target.value as WhiteboardMode)}
              className="mt-1 w-full rounded-lg border border-white/15 bg-ink-850 px-2 py-1.5 text-xs text-ink-50"
            >
              <option value="EVERYONE">Everyone</option>
              <option value="HOSTS_ONLY">Hosts and co-hosts only</option>
              <option value="SELECTED">Only people I choose</option>
            </select>
            <p className="mt-1 text-[10px] text-ink-500">
              Individual access is granted from the participant menu.
            </p>
          </div>
        )}
      </div>

      {/* ---- canvas ---- */}
      <div ref={containerRef} className="relative min-h-0 flex-1 bg-[#0b1120]">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => void onPointerUp()}
          onPointerCancel={() => void onPointerUp()}
          // touch-none stops the browser scrolling the panel while drawing.
          className={`absolute inset-0 touch-none ${canDraw ? 'cursor-crosshair' : 'cursor-not-allowed'}`}
          aria-label="Shared whiteboard"
          role="img"
        />
      </div>
    </div>
  );
}
