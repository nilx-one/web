// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { ResolvedAvatarScene } from "@nilx-one/application";
import {
  createAvatarPreview,
  type AvatarPreview,
  type AvatarPreviewFraming,
  type AvatarPreviewStatus,
} from "@nilx-one/graphics";
import { avatarAssetUrl, avatarPreviewUrl } from "@nilx-one/map-contract";
import { useEffect, useRef, useState } from "react";

import { prefersReducedMotion } from "../../shell/motion";

export interface AvatarPreviewCanvasProps {
  readonly scene: ResolvedAvatarScene;
  readonly framing?: AvatarPreviewFraming;
  /** What this preview is of, said for anyone who cannot see it. */
  readonly label: string;
  readonly className?: string;
  /** Play the study's ambient clip. A small field is left standing still. */
  readonly animated?: boolean;
}

/**
 * The body itself, standing in the interface.
 *
 * It draws the same resolved body the world does, so a person is never shown
 * one outfit here and another one outside. A host that cannot draw it, or an
 * asset that does not arrive, falls back to the study's published still rather
 * than to an empty frame — a preview that shows nothing says nothing.
 */
export function AvatarPreviewCanvas({
  scene,
  framing = "full-body",
  label,
  className,
  animated = false,
}: AvatarPreviewCanvasProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<AvatarPreview | null>(null);
  const [status, setStatus] = useState<AvatarPreviewStatus>({ kind: "idle" });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const preview = createAvatarPreview(canvas, {
      reducedMotion: !animated || prefersReducedMotion(),
      ...(animated ? { clipId: "idle" } : {}),
      onStatus: setStatus,
    });
    previewRef.current = preview;

    const measure = () => {
      const box = canvas.getBoundingClientRect();
      preview.resize(box.width, box.height);
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(canvas);

    return () => {
      observer?.disconnect();
      previewRef.current = null;
      // Closing a surface gives its body back rather than keeping every study
      // a person looked at while they were deciding.
      preview.dispose();
    };
  }, [animated]);

  useEffect(() => {
    previewRef.current?.setFraming(framing);
  }, [framing]);

  useEffect(() => {
    previewRef.current?.show({
      key: scene.key,
      assetUrl: avatarAssetUrl(scene.modelId),
      visibleNodes: scene.visibleNodes,
    });
  }, [scene.key, scene.modelId, scene.visibleNodes]);

  const failed = status.kind === "unavailable";

  return (
    <span
      className={`avatar-preview${className === undefined ? "" : ` ${className}`}`}
    >
      <canvas
        ref={canvasRef}
        className="avatar-preview__canvas"
        aria-hidden="true"
        hidden={failed}
      />
      {failed ? (
        <img
          className="avatar-preview__still"
          src={avatarPreviewUrl(scene.modelId)}
          alt={label}
        />
      ) : (
        <span className="visually-hidden">{label}</span>
      )}
    </span>
  );
}
