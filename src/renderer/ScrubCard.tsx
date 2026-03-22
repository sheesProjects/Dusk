import { useEffect, useRef, useState } from 'react';

type ScrubCardProps = {
  label: string;
  value: string;
  previousValue: string;
  nextValue: string;
  onStep: (delta: number) => void;
  accent?: 'warm' | 'cool';
  disabled?: boolean;
  size?: 'default' | 'compact';
};

export function ScrubCard({
  label,
  value,
  previousValue,
  nextValue,
  onStep,
  accent = 'warm',
  disabled = false,
  size = 'default',
}: ScrubCardProps) {
  const dragStateRef = useRef<{ pointerId: number; clientY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const elementRef = useRef<HTMLDivElement>(null);
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const stepSizePx = 28;

  useEffect(() => {
    const el = elementRef.current;

    if (!el) {
      return undefined;
    }

    function handleWheel(event: WheelEvent) {
      if (disabled) {
        return;
      }

      event.preventDefault();
      onStepRef.current(event.deltaY > 0 ? 1 : -1);
    }

    el.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [disabled]);

  function finishDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
      setIsDragging(false);

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }

  return (
    <div
      aria-label={`${label} picker`}
      aria-orientation="vertical"
      aria-valuetext={`${label} ${value}`}
      aria-disabled={disabled}
      className={[
        'scrub-card',
        accent === 'cool' ? 'scrub-card-cool' : '',
        isDragging ? 'is-dragging' : '',
        disabled ? 'is-disabled' : '',
        size === 'compact' ? 'scrub-card-compact' : '',
      ].filter(Boolean).join(' ')}
      onKeyDown={(event) => {
        if (disabled) {
          return;
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault();
          onStep(1);
        }

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          onStep(-1);
        }
      }}
      onPointerCancel={finishDrag}
      onPointerDown={(event) => {
        if (disabled) {
          return;
        }

        dragStateRef.current = {
          pointerId: event.pointerId,
          clientY: event.clientY,
        };
        setIsDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (disabled) {
          return;
        }

        const dragState = dragStateRef.current;

        if (!dragState || dragState.pointerId !== event.pointerId) {
          return;
        }

        const delta = dragState.clientY - event.clientY;

        if (Math.abs(delta) < stepSizePx) {
          return;
        }

        const steps = Math.trunc(delta / stepSizePx);

        if (steps !== 0) {
          onStep(steps);
          dragStateRef.current = {
            ...dragState,
            clientY: dragState.clientY - (steps * stepSizePx),
          };
        }
      }}
      onPointerUp={finishDrag}
      ref={elementRef}
      role="spinbutton"
      tabIndex={disabled ? -1 : 0}
    >
      <span className="stepper-label">{label}</span>
      <div className="scrub-track">
        <span className="scrub-preview">{previousValue}</span>
        <strong className="scrub-value">{value}</strong>
        <span className="scrub-preview">{nextValue}</span>
      </div>
    </div>
  );
}
