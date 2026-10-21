import React, { useEffect, useRef, useState } from 'react';
import { Crown, Key, Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { createAudioMeter, getLocalUserMedia } from '../../utils/media';
import { useAuth } from '../../context/AuthContext';
import { IslamicStarRosette } from '../common/IslamicStarRosette';
import { SanctuaryLoader } from '../common/SanctuaryLoader';
import { getBackendApiUrl } from '../../utils/urlHelper';
import heroStainedGlassImg from '../../assets/images/hero_stained_glass_1791132771042.jpg';

interface PreJoinScreenProps {
  roomId: string;
  sessionTitle?: string;
  isHostDefault?: boolean;
  defaultUserName: string;
  onEnterMeeting: (params: {
    roomId: string;
    userName: string;
    isHost: boolean;
    stream: MediaStream | null;
    isMuted: boolean;
    isVideoOff: boolean;
    title?: string;
  }) => void;
  onCancel: () => void;
  onOpenAuthModal?: () => void;
}

export const PreJoinScreen: React.FC<PreJoinScreenProps> = ({
  roomId,
  sessionTitle,
  isHostDefault = false,
  defaultUserName,
  onEnterMeeting,
  onCancel,
  onOpenAuthModal,
}) => {
  const { user, isModerator } = useAuth();
  const [userName, setUserName] = useState(defaultUserName || user?.displayName || '');
  const [displayTitle, setDisplayTitle] = useState(sessionTitle || `Majlis (${roomId})`);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [micVolume, setMicVolume] = useState(0);
  // Only authorized accounts get moderator privileges or can choose moderator role
  const [isHost, setIsHost] = useState(Boolean(isModerator && (isHostDefault !== false)));
  const [isConnecting, setIsConnecting] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let active = true;
    if (roomId) {
      fetch(getBackendApiUrl(`/api/room/${roomId}`))
        .then((res) => res.json())
        .then((data) => {
          if (active && data.exists && data.title) {
            setDisplayTitle(data.title);
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [roomId]);

  useEffect(() => {
    let active = true;

    async function initMedia() {
      try {
        const { stream: localStream } = await getLocalUserMedia(
          isCameraOn,
          isMicOn,
          userName || 'You'
        );
        if (active) {
          setStream(localStream);
          if (videoRef.current) {
            videoRef.current.srcObject = localStream;
          }
        }
      } catch (e) {
        console.warn('Pre-join media init error:', e);
      }
    }

    initMedia();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (stream) {
      stream.getVideoTracks().forEach((track) => (track.enabled = isCameraOn));
      stream.getAudioTracks().forEach((track) => (track.enabled = isMicOn));
    }
  }, [isCameraOn, isMicOn, stream]);

  useEffect(() => {
    if (!stream || !isMicOn) {
      setMicVolume(0);
      return;
    }
    const cleanup = createAudioMeter(stream, (lvl) => setMicVolume(lvl));
    return cleanup;
  }, [stream, isMicOn]);

  const handleToggleHostMode = () => {
    setIsHost((prev) => !prev);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isConnecting) return;
    setIsConnecting(true);

    // Only authorized accounts can be host/moderator, and only if they chose to join with controls
    const willBeHost = Boolean(isModerator && isHost);
    const finalName = userName.trim() || (willBeHost ? 'Moderator' : 'Seeker');
    localStorage.setItem('infinitymeet_username', finalName);

    setTimeout(() => {
      onEnterMeeting({
        roomId: roomId.trim().toLowerCase(),
        userName: finalName,
        isHost: willBeHost,
        stream,
        isMuted: !isMicOn,
        isVideoOff: !isCameraOn,
        title: displayTitle,
      });
    }, 400);
  };

  const handleCancel = () => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    onCancel();
  };

  return (
    <div className="min-h-screen bg-[#140D08] text-[#1C1917] flex flex-col items-center justify-center p-4 select-none relative overflow-hidden">
      {isConnecting && (
        <SanctuaryLoader message="Entering Sanctuary..." subMessage={`Joining "${displayTitle}"`} />
      )}
      {/* Ambient Stained Glass Sanctuary Background */}
      <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
        <img
          src={heroStainedGlassImg}
          alt="Majlis Sanctuary"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover filter blur-xs brightness-[0.6] contrast-[1.05]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#160E09]/80 via-[#100A06]/65 to-[#0A0503]/85" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-gradient-to-r from-[#E9A83A]/20 via-[#075E4A]/25 to-[#174A83]/20 blur-3xl pointer-events-none rounded-full" />
      </div>

      <div className="w-full max-w-md bg-[#FFFCF5] border border-[#302116] rounded-sm p-6 sm:p-7 space-y-5 shadow-2xl relative z-10">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[#E6DFD5] pb-4">
          <IslamicStarRosette size={32} variant="full" />
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8E7E73] flex items-center gap-1.5">
              <span>The Wisdom Lounge</span>
              <span className="text-[#E9A83A]">✦</span>
            </div>
            <h1 className="text-xl font-bold text-[#1C1917]">
              Step into Majlis
            </h1>
          </div>
        </div>

        {/* Room Info */}
        <div className="bg-[#FAF8F5] border border-[#E6DFD5] rounded-sm p-3.5 text-xs space-y-1">
          <div className="font-bold text-[#1C1917] text-sm">{displayTitle}</div>
          <div className="text-[#8E7E73] font-mono text-[11px] flex items-center justify-between">
            <span className="text-[#302116]">Circle ID: #{roomId}</span>
            <span className="text-[#075E4A] font-semibold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#19A6A0]" />
              Active Sanctuary
            </span>
          </div>
        </div>

        {/* Camera Preview */}
        <div className="relative aspect-video rounded-sm bg-[#160E09] overflow-hidden border border-[#302116] flex items-center justify-center shadow-md">
          {/* Architectural corner mullions */}
          <div className="absolute top-0 left-0 w-2.5 h-2.5 border-t-2 border-l-2 border-[#E9A83A]/60 z-20 pointer-events-none" />
          <div className="absolute top-0 right-0 w-2.5 h-2.5 border-t-2 border-r-2 border-[#E9A83A]/60 z-20 pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-2.5 h-2.5 border-b-2 border-l-2 border-[#E9A83A]/60 z-20 pointer-events-none" />
          <div className="absolute bottom-0 right-0 w-2.5 h-2.5 border-b-2 border-r-2 border-[#E9A83A]/60 z-20 pointer-events-none" />

          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover scale-x-[-1] ${
              !isCameraOn ? 'opacity-0' : 'opacity-100'
            }`}
          />
          {!isCameraOn && (
            <div className="flex flex-col items-center gap-2 text-xs text-[#8E7E73]">
              <IslamicStarRosette size={24} variant="gold-outline" />
              <span className="flex items-center gap-1.5">
                <VideoOff className="w-4 h-4 text-[#E9A83A]" /> Camera Off
              </span>
            </div>
          )}

          {/* Mic Meter */}
          <div className="absolute bottom-2 left-2 bg-[#1A110B]/90 border border-[#302116] px-2 py-1 rounded-sm text-white flex items-center gap-2 text-xs">
            {isMicOn ? (
              <Mic className="w-3.5 h-3.5 text-[#19A6A0]" />
            ) : (
              <MicOff className="w-3.5 h-3.5 text-[#A83245]" />
            )}
            <div className="w-12 h-1 bg-[#2B1B12] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#19A6A0] transition-all duration-75"
                style={{ width: `${Math.min(100, micVolume * 1.5)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Audio / Video Toggles */}
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setIsMicOn(!isMicOn)}
            className={`flex-1 py-2 rounded-sm text-xs font-semibold border transition-colors flex items-center justify-center gap-1.5 ${
              isMicOn
                ? 'bg-[#EFECE4] border-[#D9D0C3] text-[#302116]'
                : 'bg-red-50 border-red-200 text-[#A83245]'
            }`}
          >
            {isMicOn ? <Mic className="w-3.5 h-3.5 text-[#075E4A]" /> : <MicOff className="w-3.5 h-3.5" />}
            <span>{isMicOn ? 'Mic Active' : 'Mic Muted'}</span>
          </button>
          <button
            type="button"
            onClick={() => setIsCameraOn(!isCameraOn)}
            className={`flex-1 py-2 rounded-sm text-xs font-semibold border transition-colors flex items-center justify-center gap-1.5 ${
              isCameraOn
                ? 'bg-[#EFECE4] border-[#D9D0C3] text-[#302116]'
                : 'bg-red-50 border-red-200 text-[#A83245]'
            }`}
          >
            {isCameraOn ? <Video className="w-3.5 h-3.5 text-[#075E4A]" /> : <VideoOff className="w-3.5 h-3.5" />}
            <span>{isCameraOn ? 'Camera Active' : 'Camera Off'}</span>
          </button>
        </div>

        {/* Authorized Moderator Role Selection — Shown ONLY if signed in with an authorized moderator account */}
        {isModerator && (
          <div className="p-3 bg-[#FAF8F5] border border-[#E9A83A]/40 rounded-sm space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <Crown className={`w-3.5 h-3.5 ${isHost ? 'text-[#E9A83A]' : 'text-[#8E7E73]'}`} />
                <div>
                  <span className="font-semibold text-[#1C1917] block">Join with Moderator Controls</span>
                  <span className="text-[10px] text-[#8E7E73]">Authorized account ({user?.email})</span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleToggleHostMode}
                className={`w-9 h-5 rounded-full relative flex items-center transition-colors px-0.5 shrink-0 ${
                  isHost ? 'bg-[#075E4A]' : 'bg-[#D9D0C3]'
                }`}
                title={isHost ? 'Moderator controls enabled' : 'Joining as standard attendee'}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white shadow transform transition-transform ${
                    isHost ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <div className="text-[11px] text-[#68594E] bg-[#EFECE4] px-2.5 py-1.5 rounded-xs flex items-center justify-between">
              <span>Status: <strong className={isHost ? 'text-[#075E4A]' : 'text-[#8E7E73]'}>{isHost ? 'Facilitator / Host' : 'Standard Attendee'}</strong></span>
              <button
                type="button"
                onClick={handleToggleHostMode}
                className="text-[10px] font-semibold text-[#075E4A] hover:underline"
              >
                {isHost ? 'Switch to Attendee' : 'Enable Controls'}
              </button>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 pt-1 border-t border-[#E6DFD5]">
          <div>
            <label className="text-xs font-semibold text-[#1C1917] block mb-1">
              Your Display Name
            </label>
            <input
              type="text"
              required
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Display Name..."
              className="w-full bg-[#FFFCF5] border border-[#D9D0C3] rounded-sm px-3.5 py-2 text-xs text-[#1C1917] focus:outline-none focus:border-[#075E4A]"
            />
          </div>

          <div className="flex items-center justify-between text-xs pt-1">
            <button
              type="button"
              onClick={handleCancel}
              className="text-[#8E7E73] hover:text-[#1C1917] font-medium"
            >
              Cancel
            </button>

            <button
              type="submit"
              className="px-5 py-2.5 bg-[#075E4A] hover:bg-[#05493A] text-[#FFFCF5] font-semibold text-xs rounded-sm transition-colors border border-[#19A6A0]/40 shadow-xs"
            >
              Enter Sanctuary
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
