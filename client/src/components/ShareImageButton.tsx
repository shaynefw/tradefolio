import { useState, type RefObject } from "react";
import { Camera, Loader2, Copy, Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { copyNodeAsImage, downloadNodeAsImage } from "../lib/share-image";

interface ShareImageButtonProps {
  /** Ref to the DOM node that should be captured. */
  target: RefObject<HTMLElement | null>;
  /** Filename prefix (date is appended automatically). */
  filename: string;
  /** Optional label override for the trigger button. */
  label?: string;
}

/**
 * Drop-in "share as image" button. Opens a dropdown with two actions:
 * download PNG, or copy PNG to clipboard (handy for pasting into social
 * media composers). Shows a spinner while the capture is in progress.
 */
export function ShareImageButton({
  target,
  filename,
  label = "Share",
}: ShareImageButtonProps) {
  const [pending, setPending] = useState(false);

  async function handleDownload() {
    if (!target.current) {
      toast.error("Nothing to capture yet");
      return;
    }
    setPending(true);
    try {
      await downloadNodeAsImage(target.current, { filename });
      toast.success("Image downloaded");
    } catch (err) {
      console.error(err);
      toast.error("Could not generate image");
    } finally {
      setPending(false);
    }
  }

  async function handleCopy() {
    if (!target.current) {
      toast.error("Nothing to capture yet");
      return;
    }
    setPending(true);
    try {
      const result = await copyNodeAsImage(target.current, { filename });
      toast.success(
        result === "copied"
          ? "Image copied to clipboard"
          : "Image downloaded (clipboard unavailable)"
      );
    } catch (err) {
      console.error(err);
      toast.error("Could not generate image");
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={pending}>
          {pending ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Camera className="mr-2 h-3.5 w-3.5" />
          )}
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleDownload}>
          <Download className="mr-2 h-3.5 w-3.5" />
          Download PNG
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopy}>
          <Copy className="mr-2 h-3.5 w-3.5" />
          Copy to clipboard
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
