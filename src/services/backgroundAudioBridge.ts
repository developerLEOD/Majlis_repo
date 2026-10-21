/**
 * Background Audio Bridge & WakeLock Service for InfinityMeet / Majlis
 *
 * Why this is critical:
 * When users switch tabs or background the browser window/app, browsers (Chrome, Safari, iOS, Android, Firefox)
 * aggressively throttle background timers and pause MediaStreams/AudioContexts unless:
 * 1. An active HTMLAudioElement is playing media or attached to Web Audio destination with uninterrupted playback.
 * 2. An inaudible, looping background audio heartbeat or AudioContext oscillator is active (keeps audio pipeline awake).
 * 3. Navigator Screen WakeLock API prevents background sleep and suspended processes.
 * 4. Visibilitychange and focus events immediately resume the AudioContext and re-trigger .play() on all remote audio elements.
 * 5. MediaSession API metadata registers the ongoing voice call with OS-level audio routing.
 */

class BackgroundAudioBridgeService {
  private audioCtx: AudioContext | null = null;
  private wakeLock: any = null;
  private silentHeartbeatAudio: HTMLAudioElement | null = null;
  private isInitialized = false;
  private remoteAudioElements = new Map<string, HTMLAudioElement>();

  public init(roomTitle = 'Majlis Sanctuary') {
    if (this.isInitialized || typeof window === 'undefined') return;
    this.isInitialized = true;

    // 1. Initialize audio heartbeat
    this.setupHeartbeat();

    // 2. Request WakeLock
    this.requestWakeLock();

    // 3. Register MediaSession for system-level background audio priority
    this.setupMediaSession(roomTitle);

    // 4. Listen to visibility and focus events
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('focus', this.handleVisibilityChange);
    window.addEventListener('pageshow', this.handleVisibilityChange);
  }

  private setupHeartbeat() {
    try {
      // Create a persistent audio context with low latency
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass && !this.audioCtx) {
        this.audioCtx = new AudioContextClass({ latencyHint: 'interactive' });
        
        // Create an inaudible continuous carrier tone (frequency: 20Hz, gain: 0.00001)
        // This instructs the browser's audio HAL that an active continuous real-time audio stream is playing
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.frequency.setValueAtTime(25, this.audioCtx.currentTime); // Inaudible sub-bass
        gain.gain.setValueAtTime(0.00001, this.audioCtx.currentTime); // Imperceptible
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start();

        if (this.audioCtx.state === 'suspended') {
          const resume = () => {
            this.audioCtx?.resume().catch(() => {});
            window.removeEventListener('click', resume);
            window.removeEventListener('keydown', resume);
            window.removeEventListener('touchstart', resume);
          };
          window.addEventListener('click', resume);
          window.addEventListener('keydown', resume);
          window.addEventListener('touchstart', resume);
        }
      }

      // In addition, prepare an inaudible looping HTMLAudioElement (crucial for iOS Safari background media engine)
      if (!this.silentHeartbeatAudio) {
        // 1-second silent WAV base64
        const silentWav = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
        const audio = new Audio(silentWav);
        audio.loop = true;
        audio.volume = 0.01;
        (audio as any).playsInline = true;
        audio.setAttribute('playsinline', '');
        audio.setAttribute('webkit-playsinline', '');
        audio.play().catch(() => {});
        this.silentHeartbeatAudio = audio;
      }
    } catch (e) {
      console.warn('Background audio heartbeat initialization warning:', e);
    }
  }

  public registerRemoteStream(peerId: string, stream: MediaStream) {
    if (typeof window === 'undefined') return;

    let audioEl = this.remoteAudioElements.get(peerId);
    if (!audioEl) {
      audioEl = new Audio();
      audioEl.autoplay = true;
      (audioEl as any).playsInline = true;
      audioEl.setAttribute('playsinline', '');
      audioEl.setAttribute('webkit-playsinline', '');
      this.remoteAudioElements.set(peerId, audioEl);
    }

    if (audioEl.srcObject !== stream) {
      audioEl.srcObject = stream;
    }
    audioEl.play().catch(() => {});

    // Ensure audio tracks are monitored
    stream.getAudioTracks().forEach((track) => {
      track.onunmute = () => {
        audioEl?.play().catch(() => {});
      };
      track.onmute = () => {};
    });
  }

  public unregisterRemoteStream(peerId: string) {
    const audioEl = this.remoteAudioElements.get(peerId);
    if (audioEl) {
      try {
        audioEl.pause();
        audioEl.srcObject = null;
      } catch (e) {}
      this.remoteAudioElements.delete(peerId);
    }
  }

  private handleVisibilityChange = () => {
    // If returning or switching, immediately resume audio context and all peer streams
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }

    if (this.silentHeartbeatAudio && this.silentHeartbeatAudio.paused) {
      this.silentHeartbeatAudio.play().catch(() => {});
    }

    for (const audioEl of this.remoteAudioElements.values()) {
      if (audioEl && audioEl.paused) {
        audioEl.play().catch(() => {});
      }
    }

    if (!document.hidden) {
      this.requestWakeLock();
    }
  };

  private async requestWakeLock() {
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
      try {
        this.wakeLock = await (navigator as any).wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null;
        });
      } catch (err) {
        // Ignore if unsupported or battery-restricted
      }
    }
  }

  private setupMediaSession(roomTitle: string) {
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: roomTitle || 'Majlis Voice Circle',
          artist: 'The Wisdom Lounge',
          album: 'Majlis Sanctuary',
          artwork: [
            { src: '/favicon.ico', sizes: '64x64', type: 'image/x-icon' },
          ],
        });

        // Set action handlers to maintain audio session focus
        navigator.mediaSession.setActionHandler('play', () => {
          this.handleVisibilityChange();
        });
        navigator.mediaSession.setActionHandler('pause', () => {});
      } catch (e) {
        // ignore
      }
    }
  }

  public cleanup() {
    this.isInitialized = false;

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      window.removeEventListener('focus', this.handleVisibilityChange);
      window.removeEventListener('pageshow', this.handleVisibilityChange);
    }

    if (this.wakeLock) {
      try {
        this.wakeLock.release().catch(() => {});
      } catch (e) {}
      this.wakeLock = null;
    }

    if (this.silentHeartbeatAudio) {
      try {
        this.silentHeartbeatAudio.pause();
        this.silentHeartbeatAudio.srcObject = null;
      } catch (e) {}
      this.silentHeartbeatAudio = null;
    }

    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try {
        this.audioCtx.close().catch(() => {});
      } catch (e) {}
      this.audioCtx = null;
    }

    for (const audioEl of this.remoteAudioElements.values()) {
      try {
        audioEl.pause();
        audioEl.srcObject = null;
      } catch (e) {}
    }
    this.remoteAudioElements.clear();
  }
}

export const backgroundAudioBridge = new BackgroundAudioBridgeService();
