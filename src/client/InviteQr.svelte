<script lang="ts">
  import { onMount } from "svelte";
  import { QrCode } from "@marianmeres/svelte-qrcode";
  import { icons } from "./icons";

  let { url, roomCode }: { url: string; roomCode: string } = $props();
  let imageRoot = $state<HTMLDivElement>();
  let imageFile = $state<File | null>(null);
  let downloadUrl = $state("");
  let status = $state("Preparing QR image...");
  let failure = $state("");
  let sharing = $state(false);
  const canShare = $derived(!!imageFile && typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" && navigator.canShare({ files: [imageFile] }));

  onMount(() => {
    let cancelled = false;
    const image = new Image();
    async function prepare() {
      try {
        const svg = imageRoot?.querySelector("svg")?.cloneNode(true);
        if (!(svg instanceof SVGSVGElement)) throw new Error("The invitation QR is missing");
        svg.setAttribute("width", "1024"); svg.setAttribute("height", "1024");
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("The QR image could not load"));
          image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
        });
        if (cancelled) return;
        const canvas = document.createElement("canvas");
        canvas.width = 1024; canvas.height = 1024;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas is unavailable");
        context.drawImage(image, 0, 0, 1024, 1024);
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(value => value ? resolve(value) : reject(new Error("PNG encoding failed")), "image/png");
        });
        if (cancelled) return;
        imageFile = new File([blob], `monk-room-${roomCode}.png`, { type: "image/png" });
        downloadUrl = URL.createObjectURL(imageFile);
        status = "";
      } catch (error) {
        if (cancelled) return;
        failure = "Could not prepare the QR image. Copy the invite link instead.";
        status = "";
        console.error("Monk invitation QR image failed", error);
      }
    }
    void prepare();
    return () => {
      cancelled = true;
      image.onload = null; image.onerror = null;
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  });

  async function share() {
    failure = ""; status = ""; sharing = true;
    try {
      if (!imageFile) throw new Error("The QR image is not ready");
      await navigator.share({ title: `Join Monk room ${roomCode}`, files: [imageFile] });
      status = "QR code opened for sharing.";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") status = "Sharing canceled.";
      else {
        failure = "Could not share the QR image. Download the QR code instead.";
        console.error("Monk invitation QR sharing failed", error);
      }
    } finally { sharing = false; }
  }
</script>

<figure class="invite-qr">
  <div class="invite-qr-image" bind:this={imageRoot} role="img" aria-label="QR code to join Monk room {roomCode}">
    <div aria-hidden="true">
      <QrCode content={url} ecl="quartile" border={4} color="#171719" bgColor="#ffffff" />
    </div>
  </div>
  <figcaption>Scan to join room {roomCode}.</figcaption>
</figure>
<div>
  {#if canShare}
    <button type="button" id="action-share-qr" class="secondary" disabled={sharing} aria-busy={sharing} onclick={share}>
      <img class="ui-icon" src={icons.invite} alt="" aria-hidden="true" />Share QR code
    </button>
  {/if}
  {#if downloadUrl && imageFile}
    <a id="action-download-qr" class="qr-download" href={downloadUrl} download={imageFile.name}>
      <img class="ui-icon" src={icons.download} alt="" aria-hidden="true" />Download QR code
    </a>
  {/if}
</div>
{#if status}<p class="radar-note" role="status">{status}</p>{/if}
{#if failure}<p class="error" role="alert">{failure}</p>{/if}
