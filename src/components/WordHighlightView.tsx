"use client";

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { segmentTextIntoWords } from "@/lib/word-timestamps";
import type { ChunkAlignment, WordTimestamp } from "@/types/tts";

export interface WordHighlightViewProps {
  text: string;
  chunks: ChunkAlignment[];
  isPlaying: boolean;
  initialTimeMs?: number;
  clockRef?: React.RefObject<HTMLSpanElement | null>;
  activeChunkIndex: number | null;
  activeWord: WordTimestamp | null;
  onRequestEdit?: () => void;
  onExportTimestamps?: () => void;
}

export function formatTimeMs(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const minutes = Math.floor(safeMs / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);
  const tenths = Math.floor((safeMs % 1000) / 100);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

type WordVisualState = "idle" | "sentence" | "spoken" | "active";

interface WordTokenProps {
  text: string;
  wordIndex: number;
  visualState: WordVisualState;
  activeRef?: React.Ref<HTMLSpanElement>;
}

const WordToken = React.memo(function WordToken({
  text,
  wordIndex,
  visualState,
  activeRef,
}: WordTokenProps) {
  let className = "word-token";
  if (visualState === "active") {
    className += " word-active";
  } else if (visualState === "spoken") {
    className += " word-spoken";
  } else if (visualState === "sentence") {
    className += " word-active-sentence";
  }

  return (
    <span
      ref={activeRef}
      className={className}
      data-word-index={wordIndex}
      data-active={visualState === "active" ? "true" : undefined}
    >
      {text}
    </span>
  );
});

export const WordHighlightView = React.memo(function WordHighlightView({
  text,
  chunks,
  isPlaying,
  initialTimeMs = 0,
  clockRef,
  activeChunkIndex,
  activeWord,
  onRequestEdit,
  onExportTimestamps,
}: WordHighlightViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeWordElRef = useRef<HTMLSpanElement | null>(null);
  const wordLookupRef = useRef<Map<number, WordTimestamp>>(new Map());

  const { segments, wordCount } = useMemo(
    () => segmentTextIntoWords(text),
    [text],
  );

  const alignedWordCount = useMemo(() => {
    const map = new Map<number, WordTimestamp>();
    for (const chunk of chunks) {
      for (const word of chunk.words) {
        map.set(word.wordIndex, word);
      }
    }
    wordLookupRef.current = map;
    return map.size;
  }, [chunks]);

  const activeChunkSpan = useMemo(() => {
    if (activeChunkIndex === null) return null;
    return chunks.find((c) => c.chunkIndex === activeChunkIndex) ?? null;
  }, [chunks, activeChunkIndex]);

  const activeWordIndex = activeWord?.wordIndex ?? null;

  useEffect(() => {
    if (!isPlaying || activeWordIndex === null) return;
    const el = activeWordElRef.current;
    const container = containerRef.current;
    if (!el || !container) return;

    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const padding = 48;

    if (elRect.bottom > containerRect.bottom - padding) {
      const scrollStep = Math.max(80, containerRect.height * 0.35);
      container.scrollTop += elRect.bottom - (containerRect.bottom - scrollStep);
    } else if (elRect.top < containerRect.top + padding) {
      container.scrollTop -= containerRect.top + padding - elRect.top;
    }
  }, [isPlaying, activeWordIndex]);

  const handleSurfaceMouseOver = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      if (!target || target.dataset.wordIndex === undefined) return;
      const wIdx = Number(target.dataset.wordIndex);
      const aligned = wordLookupRef.current.get(wIdx);
      if (aligned) {
        const expectedTitle = `${aligned.text} (${aligned.startMs}ms – ${aligned.endMs}ms)`;
        if (target.title !== expectedTitle) {
          target.title = expectedTitle;
        }
      }
    },
    [],
  );

  const sentenceStart = activeChunkSpan?.charStart ?? -1;
  const sentenceEnd = activeChunkSpan?.charEnd ?? -1;

  return (
    <div className="reader-wrapper">
      <div className="reader-statusbar">
        <div className="reader-metrics">
          <span className={`status-dot ${isPlaying ? "live" : ""}`} />
          <span ref={clockRef} className="reader-clock">
            {formatTimeMs(initialTimeMs)}
          </span>
          {activeWord ? (
            <span className="active-word-pill" title="Current word timestamp">
              <strong>{activeWord.text}</strong>
              <code>
                {activeWord.startMs}ms – {activeWord.endMs}ms
              </code>
            </span>
          ) : (
            <span className="reader-hint">
              {alignedWordCount > 0
                ? `${alignedWordCount} / ${wordCount} words aligned`
                : `${wordCount} words ready • Press "Stream to Speakers" to highlight words live`}
            </span>
          )}
        </div>

        <div className="reader-actions">
          {alignedWordCount > 0 && onExportTimestamps && (
            <button
              type="button"
              className="secondary-chip-btn"
              onClick={onExportTimestamps}
              title="Export word-level timestamps as JSON"
            >
              Export Timestamps JSON ({alignedWordCount})
            </button>
          )}
          {!isPlaying && onRequestEdit && (
            <button
              type="button"
              className="secondary-chip-btn"
              onClick={onRequestEdit}
            >
              Edit Text
            </button>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="word-highlight-surface"
        onMouseOver={handleSurfaceMouseOver}
        onDoubleClick={() => {
          if (!isPlaying && onRequestEdit) {
            onRequestEdit();
          }
        }}
        role="region"
        aria-label="Live word highlight transcript"
      >
        {segments.length === 0 ? (
          <span className="reader-placeholder">
            No text entered. Switch to Edit Text to enter content for speech synthesis.
          </span>
        ) : (
          segments.map((seg) => {
            if (seg.type === "whitespace") {
              return (
                <React.Fragment key={`ws-${seg.charStart}`}>
                  {seg.text}
                </React.Fragment>
              );
            }

            const wIdx = seg.wordIndex!;
            let visualState: WordVisualState = "idle";
            if (isPlaying) {
              if (activeWordIndex === wIdx) {
                visualState = "active";
              } else if (activeWordIndex !== null && wIdx < activeWordIndex) {
                visualState = "spoken";
              } else if (
                sentenceStart >= 0 &&
                seg.charStart >= sentenceStart &&
                seg.charEnd <= sentenceEnd
              ) {
                visualState = "sentence";
              }
            }

            return (
              <WordToken
                key={`w-${seg.charStart}`}
                text={seg.text}
                wordIndex={wIdx}
                visualState={visualState}
                activeRef={
                  visualState === "active" ? activeWordElRef : undefined
                }
              />
            );
          })
        )}
      </div>
    </div>
  );
});
