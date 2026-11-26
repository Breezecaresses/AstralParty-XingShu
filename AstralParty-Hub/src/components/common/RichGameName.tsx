import React from 'react';
import { parseRichGameName, type RichColorStop } from '../../shared/richGameName';

export interface RichGameNameProps {
  text?: string | null;
  fallback?: string;
  className?: string;
  style?: React.CSSProperties;
}

function stopCssColor(stop: RichColorStop): string {
  if (stop.opacity >= 1) return stop.hex;
  const r = parseInt(stop.hex.slice(1, 3), 16);
  const g = parseInt(stop.hex.slice(3, 5), 16);
  const b = parseInt(stop.hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${stop.opacity})`;
}

export const RichGameName: React.FC<RichGameNameProps> = ({ text, fallback = '', className, style }) => {
  const parsed = parseRichGameName(text);
  const titleText = parsed.plain || fallback;

  if (parsed.runs.length === 0) {
    return (
      <span className={className} style={style} title={titleText}>
        {fallback}
      </span>
    );
  }

  if (!parsed.hasRichStyle) {
    return (
      <span className={className} style={style} title={titleText}>
        {parsed.plain}
      </span>
    );
  }

  return (
    <span className={className} style={style} title={titleText}>
      {parsed.runs.map((run, idx) => {
        const runStyle: React.CSSProperties = {};
        if (run.bold) runStyle.fontWeight = 700;
        if (run.italic) runStyle.fontStyle = 'italic';
        if (run.underline && run.strike) runStyle.textDecoration = 'underline line-through';
        else if (run.underline) runStyle.textDecoration = 'underline';
        else if (run.strike) runStyle.textDecoration = 'line-through';

        if (run.colors && run.colors.length === 1) {
          runStyle.color = stopCssColor(run.colors[0]);
        } else if (run.colors && run.colors.length >= 2) {
          runStyle.backgroundImage = `linear-gradient(90deg, ${run.colors.map(stopCssColor).join(', ')})`;
          runStyle.WebkitBackgroundClip = 'text';
          runStyle.backgroundClip = 'text';
          runStyle.color = 'transparent';
        }

        return (
          <span key={idx} style={runStyle}>
            {run.text}
          </span>
        );
      })}
    </span>
  );
};
