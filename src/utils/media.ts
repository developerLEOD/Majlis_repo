/**
 * Media and Audio helper utilities for InfinityMeet
 */

// Generate a high-quality fallback synthetic video stream with user initials and animated waves
export function createSyntheticVideoStream(userName: string, width = 640, height = 480): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase() || 'U';

  // Deterministic color based on user name
  let hash = 0;
  for (let i = 0; i < userName.length; i++) {
    hash = userName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  const bg1 = `hsl(${hue}, 40%, 15%)`;
  const bg2 = `hsl(${(hue + 40) % 360}, 50%, 8%)`;

  let frame = 0;
  const render = () => {
    frame++;
    // Gradient background
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, bg1);
    grad.addColorStop(1, bg2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Subtle animated grid / ripples
    ctx.strokeStyle = `hsla(${hue}, 60%, 50%, 0.12)`;
    ctx.lineWidth = 1.5;
    const waveRadius = 70 + Math.sin(frame * 0.05) * 8;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2 - 20, waveRadius + 20, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(width / 2, height / 2 - 20, waveRadius + 40, 0, Math.PI * 2);
    ctx.stroke();

    // Central avatar circle
    const avatarGrad = ctx.createLinearGradient(
      width / 2 - 60,
      height / 2 - 80,
      width / 2 + 60,
      height / 2 + 40
    );
    avatarGrad.addColorStop(0, `hsl(${hue}, 70%, 45%)`);
    avatarGrad.addColorStop(1, `hsl(${(hue + 50) % 360}, 80%, 35%)`);

    ctx.fillStyle = avatarGrad;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2 - 20, 56, 0, Math.PI * 2);
    ctx.fill();

    // Initials text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, width / 2, height / 2 - 18);

    // Name label
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '500 16px system-ui, -apple-system, sans-serif';
    ctx.fillText(userName, width / 2, height / 2 + 65);

    requestAnimationFrame(render);
  };

  render();
  return canvas.captureStream(24);
}

// Generate a silent audio track so WebRTC offer/answer doesn't break if no microphone is found
export function createSilentAudioStream(): MediaStream {
  const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const osc = ctx.createOscillator();
  const dst = osc.connect(ctx.createMediaStreamDestination());
  osc.start();
  // Mute track so it is completely silent
  const stream = (dst as MediaStreamAudioDestinationNode).stream;
  stream.getAudioTracks().forEach((t) => (t.enabled = false));
  return stream;
}

// Safely request local media, falling back to synthetic tracks if permissions or devices are absent
export async function getLocalUserMedia(
  video = true,
  audio = true,
  userName = 'You',
  preferredVideoId?: string,
  preferredAudioId?: string
): Promise<{ stream: MediaStream; isSyntheticVideo: boolean; isSyntheticAudio: boolean }> {
  let stream: MediaStream | null = null;
  let isSyntheticVideo = false;
  let isSyntheticAudio = false;

  const constraints: MediaStreamConstraints = {
    audio: audio
      ? preferredAudioId
        ? { deviceId: { exact: preferredAudioId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        : { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      : false,
    video: video
      ? preferredVideoId
        ? { deviceId: { exact: preferredVideoId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } }
      : false,
  };

  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (video || audio)) {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    }
  } catch (err) {
    console.warn('getUserMedia failed or restricted, trying fallback:', err);
    // If combined failed, try audio only then synthetic video
    if (audio) {
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream = audioOnly;
      } catch {
        isSyntheticAudio = true;
      }
    }
  }

  // Ensure video track exists if requested
  if (video) {
    const hasVideo = stream && stream.getVideoTracks().length > 0;
    if (!hasVideo) {
      const syntheticVideo = createSyntheticVideoStream(userName);
      isSyntheticVideo = true;
      if (!stream) {
        stream = new MediaStream();
      }
      syntheticVideo.getVideoTracks().forEach((track) => stream!.addTrack(track));
    }
  }

  // Ensure audio track exists if requested
  if (audio) {
    const hasAudio = stream && stream.getAudioTracks().length > 0;
    if (!hasAudio) {
      const silentAudio = createSilentAudioStream();
      isSyntheticAudio = true;
      if (!stream) {
        stream = new MediaStream();
      }
      silentAudio.getAudioTracks().forEach((track) => stream!.addTrack(track));
    }
  }

  if (!stream) {
    stream = new MediaStream();
  }

  return { stream, isSyntheticVideo, isSyntheticAudio };
}

// Audio volume meter helper for active speaker detection
export function createAudioMeter(stream: MediaStream, onVolume: (level: number) => void): () => void {
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) return () => {};

  let isRunning = true;
  let audioCtx: AudioContext | null = null;
  let animId: number | null = null;

  try {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);

    const buffer = new Uint8Array(analyser.frequencyBinCount);

    const checkVolume = () => {
      if (!isRunning) return;
      analyser.getByteFrequencyData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i];
      }
      const avg = sum / buffer.length;
      // Normalizing 0 - 100
      const volumeLevel = Math.min(100, Math.round((avg / 128) * 100));
      onVolume(volumeLevel);
      animId = requestAnimationFrame(checkVolume);
    };

    checkVolume();
  } catch (e) {
    console.warn('Audio meter initialization error:', e);
  }

  return () => {
    isRunning = false;
    if (animId) cancelAnimationFrame(animId);
    if (audioCtx && audioCtx.state !== 'closed') {
      audioCtx.close().catch(() => {});
    }
  };
}

// Mix multiple media streams into a single audio MediaStreamDestination with high-fidelity configurations
export function createMixedAudioStream(streams: MediaStream[]): {
  audioContext: AudioContext;
  mixedStream: MediaStream;
  cleanup: () => void;
} {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioContextClass({
    latencyHint: 'interactive',
  });

  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }

  const destination = audioCtx.createMediaStreamDestination();
  const sources: MediaStreamAudioSourceNode[] = [];

  for (const stream of streams) {
    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        if (track.enabled && track.readyState === 'live') {
          try {
            const singleTrackStream = new MediaStream([track]);
            const source = audioCtx.createMediaStreamSource(singleTrackStream);
            source.connect(destination);
            sources.push(source);
          } catch (err) {
            console.warn('Could not attach individual audio track to audio mixer:', err);
          }
        }
      });
    }
  }

  const cleanup = () => {
    sources.forEach((s) => {
      try {
        s.disconnect();
      } catch {}
    });
    if (audioCtx.state !== 'closed') {
      audioCtx.close().catch(() => {});
    }
  };

  return {
    audioContext: audioCtx,
    mixedStream: destination.stream,
    cleanup,
  };
}
