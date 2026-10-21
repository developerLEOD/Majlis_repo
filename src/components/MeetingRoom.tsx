import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Copy,
  Crown,
  Hand,
  Info,
  LayoutGrid,
  Lock,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  MoreHorizontal,
  MoreVertical,
  Plus,
  Radio,
  Settings,
  Sliders,
  Smile,
  Square,
  Users,
  Video,
  VideoOff,
  Volume2,
  X,
  MessageSquare,
  Sparkles,
} from 'lucide-react';
import { ChatMessage, MajlisSession, MeetingLayout, Participant, ReactionItem, RecordingResult } from '../types/meeting';
import { MeetingClient } from '../services/meetingClient';
import { LocalMeetingRecorder } from '../services/localRecorder';
import { VideoTile } from './VideoTile';
import { ChatDrawer } from './ChatDrawer';
import { ParticipantsDrawer } from './ParticipantsDrawer';
import { ReactionPicker } from './ReactionPicker';
import { InviteModal } from './InviteModal';
import { SettingsModal } from './SettingsModal';
import { RecordingModal } from './RecordingModal';
import { ModeratorHubModal } from './ModeratorHubModal';
import { IslamicStarRosette } from './common/IslamicStarRosette';
import { HoneycombGrid } from './common/HoneycombGrid';
import { useAuth } from '../context/AuthContext';
import { createMixedAudioStream } from '../utils/media';
import { backgroundAudioBridge } from '../services/backgroundAudioBridge';
import heroStainedGlassImg from '../assets/images/hero_stained_glass_1791132771042.jpg';
import {
  buildMeetingInviteUrl,
  copyTextToClipboard,
  fetchAppConfig,
  getCachedPublicAppUrl,
} from '../utils/urlHelper';

interface MeetingRoomProps {
  roomId: string;
  userId: string;
  userName: string;
  sessionTitle?: string;
  isHost: boolean;
  initialStream: MediaStream | null;
  initialMuted: boolean;
  initialVideoOff: boolean;
  onEndOrLeaveMeeting: (roomId?: string) => void;
}

export const MeetingRoom: React.FC<MeetingRoomProps> = ({
  roomId,
  userId,
  userName,
  sessionTitle,
  isHost: initialIsHost,
  initialStream,
  initialMuted,
  initialVideoOff,
  onEndOrLeaveMeeting,
}) => {
  const { isModerator } = useAuth();
  // Only authorized accounts can hold facilitator / moderator privileges
  const effectiveIsHost = Boolean(initialIsHost && isModerator);

  // State
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isHost, setIsHost] = useState(effectiveIsHost);
  const [isCoModerator, setIsCoModerator] = useState(false);
  const canModerate = isHost || isCoModerator;
  const [isMuted, setIsMuted] = useState(initialMuted);
  const [isVideoOff, setIsVideoOff] = useState(initialVideoOff);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [chatEnabled, setChatEnabled] = useState(true);
  const [screenShareEnabled, setScreenShareEnabled] = useState(true);

  // Layout & UI
  const [layout, setLayout] = useState<MeetingLayout>('honeycomb');
  const [pinnedUserId, setPinnedUserId] = useState<string | null>(null);
  const [activeDrawer, setActiveDrawer] = useState<'chat' | 'participants' | null>(null);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeReactions, setActiveReactions] = useState<ReactionItem[]>([]);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showModeratorHub, setShowModeratorHub] = useState(false);
  const [showLeaveConfirmDialog, setShowLeaveConfirmDialog] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isScreenMaximized, setIsScreenMaximized] = useState(false);
  const [mirrorVideo, setMirrorVideo] = useState(true);
  const [appUrl, setAppUrl] = useState<string>(getCachedPublicAppUrl());

  // Time elapsed
  const [meetingSeconds, setMeetingSeconds] = useState(0);

  // Recording State (Moderator local recording)
  const [recorder, setRecorder] = useState<LocalMeetingRecorder | null>(null);
  const [recordingStatus, setRecordingStatus] = useState<'idle' | 'recording' | 'paused' | 'stopped'>('idle');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingSizeBytes, setRecordingSizeBytes] = useState(0);
  const [remoteRecordingNotice, setRemoteRecordingNotice] = useState<{ isRecording: boolean; by: string } | null>(null);
  const [lastFinishedRecording, setLastFinishedRecording] = useState<RecordingResult | null>(null);
  const [systemBanner, setSystemBanner] = useState<string | null>(null);
  const [stageAnnouncement, setStageAnnouncement] = useState<{ text: string; senderName?: string } | null>(null);
  const [currentTitle, setCurrentTitle] = useState<string>(sessionTitle || `Majlis (${roomId})`);

  // References
  const localStreamRef = useRef<MediaStream | null>(initialStream);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenAudioMixerRef = useRef<{ audioContext: AudioContext; mixedStream: MediaStream; cleanup: () => void } | null>(null);
  const wasVideoOffRef = useRef<boolean>(initialVideoOff);
  const clientRef = useRef<MeetingClient | null>(null);
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const participantsRef = useRef<Participant[]>([]);

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  useEffect(() => {
    const el = screenVideoRef.current;
    const screenSharer = participants.find((p) => p.isScreenSharing);
    if (el && screenSharer?.stream) {
      if (el.srcObject !== screenSharer.stream) {
        el.srcObject = screenSharer.stream || null;
      }
      el.play().catch(() => {});
      const handleTrack = () => {
        if (el.srcObject !== screenSharer.stream) {
          el.srcObject = screenSharer.stream || null;
        }
        el.play().catch(() => {});
      };
      screenSharer.stream.getTracks().forEach((t) => {
        t.onunmute = handleTrack;
        t.onmute = handleTrack;
      });
    }
  }, [participants]);

  // Auto-spotlight stage when a participant shares screen
  useEffect(() => {
    const screenSharer = participants.find((p) => p.isScreenSharing);
    if (screenSharer) {
      setPinnedUserId((curr) => curr || screenSharer.id);
    }
  }, [participants]);

  useEffect(() => {
    const timer = setInterval(() => {
      setMeetingSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    async function loadConfig() {
      const url = await fetchAppConfig();
      if (url) setAppUrl(url);
    }
    loadConfig();
  }, []);

  const formatTime = (totalSec: number) => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  useEffect(() => {
    const localParticipant: Participant = {
      id: userId,
      name: userName,
      isHost: effectiveIsHost,
      isLocal: true,
      isMuted: initialMuted,
      isVideoOff: initialVideoOff,
      isScreenSharing: false,
      handRaised: false,
      stream: initialStream || undefined,
    };

    setParticipants([localParticipant]);

    const client = new MeetingClient({
      onRoomJoined: (data) => {
        setIsHost(effectiveIsHost || (data.isHost && isModerator));
        setIsLocked(data.locked);
        if (data.title) {
          setCurrentTitle(data.title);
        }
        if (data.isRecording) {
          setRemoteRecordingNotice({ isRecording: true, by: 'Host' });
        }
        setParticipants((prev) => {
          const list = [...prev];
          for (const p of data.participants) {
            const pId = String(p.id);
            if (pId !== userId) {
              const existingIdx = list.findIndex((e) => String(e.id) === pId);
              if (existingIdx >= 0) {
                list[existingIdx] = { ...list[existingIdx], ...p, isLocal: false };
              } else {
                list.push({ ...p, id: pId, isLocal: false });
              }
            }
          }
          return list;
        });
      },

      onRoomInfo: (info) => {
        if (info.title) {
          setCurrentTitle(info.title);
        }
        if (info.locked !== undefined) {
          setIsLocked(info.locked);
        }
      },

      onUserJoined: (user) => {
        const idStr = String(user.id);
        if (!idStr || idStr === userId) return;
        setParticipants((prev) => {
          const index = prev.findIndex((p) => String(p.id) === idStr);
          if (index >= 0) {
            const list = [...prev];
            const prevP = list[index];
            list[index] = {
              ...prevP,
              ...user,
              id: idStr,
              isLocal: false,
              stream: user.stream || prevP.stream,
            };
            return list;
          }
          return [...prev, { ...user, id: idStr, isLocal: false }];
        });
        showNotification(`${user.name || 'A seeker'} joined`);
      },

      onUserLeft: (leftUserId, leftName) => {
        const idStr = String(leftUserId);
        if (!idStr || idStr === userId) return;
        backgroundAudioBridge.unregisterRemoteStream(idStr);
        setParticipants((prev) => prev.filter((p) => String(p.id) !== idStr));
        videoElementsRef.current.delete(idStr);
        setPinnedUserId((current) => (current === idStr ? null : current));
        showNotification(`${leftName || 'A member'} left`);
      },

      onRemoteStream: (remoteUserId, stream) => {
        const idStr = String(remoteUserId);
        if (!idStr || idStr === userId) return;
        // Keep remote stream audio actively playing in background even if tab is unfocused
        backgroundAudioBridge.registerRemoteStream(idStr, stream);
        setParticipants((prev) => {
          const index = prev.findIndex((p) => String(p.id) === idStr);
          if (index >= 0) {
            const list = [...prev];
            list[index] = { ...list[index], id: idStr, stream };
            return list;
          }
          return [
            ...prev,
            {
              id: idStr,
              name: 'Member',
              isHost: false,
              isLocal: false,
              isMuted: false,
              isVideoOff: false,
              isScreenSharing: false,
              handRaised: false,
              stream,
            },
          ];
        });
      },

      onChatMessage: (message) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === message.id)) return prev;
          return [...prev, message];
        });
        if (activeDrawer !== 'chat' && message.senderId !== userId) {
          setUnreadChatCount((count) => count + 1);
        }
      },

      onReaction: (reaction) => {
        if (reaction.senderId === userId) return;
        setActiveReactions((prev) => {
          if (prev.some((r) => r.id === reaction.id)) return prev;
          return [...prev, reaction];
        });
        setTimeout(() => {
          setActiveReactions((prev) => prev.filter((r) => r.id !== reaction.id));
        }, 3500);
      },

      onForceMute: () => {
        setIsMuted(true);
        if (localStreamRef.current) {
          localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = false));
        }
        setParticipants((prev) =>
          prev.map((p) => (p.isLocal ? { ...p, isMuted: true } : p))
        );
        clientRef.current?.updateStatus({ isMuted: true });
        showNotification('Microphone muted by facilitator');
      },

      onForceUnmute: () => {
        setIsMuted(false);
        if (localStreamRef.current) {
          localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = true));
        }
        setParticipants((prev) =>
          prev.map((p) => (p.isLocal ? { ...p, isMuted: false } : p))
        );
        clientRef.current?.updateStatus({ isMuted: false });
        showNotification('Microphone unmuted by facilitator');
      },

      onForceStopVideo: () => {
        setIsVideoOff(true);
        if (localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = false));
        }
        setParticipants((prev) =>
          prev.map((p) => (p.isLocal ? { ...p, isVideoOff: true } : p))
        );
        clientRef.current?.updateStatus({ isVideoOff: true });
        showNotification('Camera turned off by facilitator');
      },

      onForceStartVideo: () => {
        setIsVideoOff(false);
        if (localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = true));
        }
        setParticipants((prev) =>
          prev.map((p) => (p.isLocal ? { ...p, isVideoOff: false } : p))
        );
        clientRef.current?.updateStatus({ isVideoOff: false });
        showNotification('Camera turned on by facilitator');
      },

      onKicked: (reason) => {
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((t) => t.stop());
        }
        if (screenStreamRef.current) {
          screenStreamRef.current.getTracks().forEach((t) => t.stop());
        }
        showNotification(reason || 'You were removed from this Majlis by the moderator.');
        setTimeout(() => {
          handleFinalExit();
        }, 300);
      },

      onLockChanged: (locked) => {
        setIsLocked(locked);
        if (!isHost) {
          showNotification(locked ? 'Majlis locked by facilitator' : 'Majlis unlocked');
        }
      },

      onRecordingNotice: (recording, by) => {
        setRemoteRecordingNotice(recording ? { isRecording: true, by } : null);
      },

      onSessionEnded: (reason) => {
        showNotification(reason || 'The facilitator has concluded this Majlis session.');
        setTimeout(() => {
          handleFinalExit();
        }, 400);
      },

      onSpotlightChanged: (targetId) => {
        setPinnedUserId(targetId || null);
        if (targetId) {
          const p = participants.find((x) => x.id === targetId);
          showNotification(`Stage spotlighted: ${p?.name || 'Attendee'}`);
        } else {
          showNotification('Spotlight cleared');
        }
      },

      onChatPermissionChanged: (enabled) => {
        setChatEnabled(enabled);
        if (!isHost) {
          showNotification(enabled ? 'Discussion chat enabled' : 'Discussion chat paused by facilitator');
        }
      },

      onScreenSharePermissionChanged: (enabled) => {
        setScreenShareEnabled(enabled);
        if (!isHost) {
          showNotification(enabled ? 'Attendee screen sharing enabled' : 'Screen sharing restricted to facilitator');
        }
      },

      onHandsLowered: () => {
        setHandRaised(false);
        setParticipants((prev) => prev.map((p) => ({ ...p, handRaised: false })));
        if (!isHost) {
          showNotification('Facilitator lowered all hands');
        }
      },

      onPromotedToHost: (msg) => {
        setIsHost(true);
        setParticipants((prev) =>
          prev.map((p) => (p.isLocal ? { ...p, isHost: true } : p))
        );
        showNotification(msg || 'You are now the facilitator of this Majlis.');
      },

      onCoModeratorStatusChanged: (coMod, assignedBy) => {
        setIsCoModerator(coMod);
        setParticipants((prev) =>
          prev.map((p) => (p.isLocal ? { ...p, isCoModerator: coMod } : p))
        );
        showNotification(
          coMod
            ? `You have been appointed as Co-Moderator by ${assignedBy || 'Moderator'}`
            : 'Your Co-Moderator role has ended.'
        );
      },

      onAnnouncement: (text, sender) => {
        setStageAnnouncement({ text, senderName: sender });
      },

      onSpeakerStatusChanged: (targetId, isSpeaker) => {
        setParticipants((prev) =>
          prev.map((p) => (p.id === targetId ? { ...p, isSpeaker } : p))
        );
      },

      onUserStatusChanged: (data) => {
        const targetId = String(data.userId);
        setParticipants((prev) =>
          prev.map((p) => {
            if (String(p.id) !== targetId) return p;
            return {
              ...p,
              isHost: data.isHost !== undefined ? data.isHost : p.isHost,
              isMuted: data.isMuted !== undefined ? data.isMuted : p.isMuted,
              isVideoOff: data.isVideoOff !== undefined ? data.isVideoOff : p.isVideoOff,
              isScreenSharing: data.isScreenSharing !== undefined ? data.isScreenSharing : p.isScreenSharing,
              handRaised: data.handRaised !== undefined ? data.handRaised : p.handRaised,
              isCoModerator: data.isCoModerator !== undefined ? data.isCoModerator : p.isCoModerator,
              isSpeaker: data.isSpeaker !== undefined ? data.isSpeaker : p.isSpeaker,
            };
          })
        );
      },

      onError: (msg) => {
        showNotification(msg);
      },
    });

    clientRef.current = client;
    client.connect(roomId, userId, userName, effectiveIsHost, initialStream, sessionTitle);

    // Initialize background audio bridge to keep outgoing/incoming voice uninterrupted when switching tabs or apps
    backgroundAudioBridge.init(sessionTitle || `Majlis (${roomId})`);

    return () => {
      client.leave();
      backgroundAudioBridge.cleanup();
    };
  }, [roomId, userId]);

  const showNotification = (text: string) => {
    setSystemBanner(text);
    setTimeout(() => {
      setSystemBanner((current) => (current === text ? null : current));
    }, 4000);
  };

  const toggleAudio = async () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);

    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      if (audioTracks.length > 0) {
        audioTracks.forEach((track) => {
          track.enabled = !nextMuted;
        });
      } else if (!nextMuted) {
        try {
          const newAudioStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
            video: false,
          });
          const newTrack = newAudioStream.getAudioTracks()[0];
          if (newTrack) {
            localStreamRef.current.addTrack(newTrack);
          }
        } catch (err) {
          console.warn('Could not acquire audio track:', err);
        }
      }
    } else if (!nextMuted) {
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: !isVideoOff,
        });
        localStreamRef.current = newStream;
      } catch (err) {
        console.warn('Could not initialize audio stream:', err);
      }
    }

    if (isScreenSharing && screenStreamRef.current) {
      const combinedStream = new MediaStream();
      screenStreamRef.current.getVideoTracks().forEach((t) => combinedStream.addTrack(t));

      const screenAudioTracks = screenStreamRef.current.getAudioTracks();
      const micAudioTracks = localStreamRef.current
        ? localStreamRef.current.getAudioTracks().filter((t) => t.enabled && t.readyState === 'live')
        : [];

      if (screenAudioMixerRef.current) {
        screenAudioMixerRef.current.cleanup();
        screenAudioMixerRef.current = null;
      }

      if (screenAudioTracks.length > 0 && micAudioTracks.length > 0 && !nextMuted) {
        const mixer = createMixedAudioStream([screenStreamRef.current, localStreamRef.current!]);
        screenAudioMixerRef.current = mixer;
        mixer.mixedStream.getAudioTracks().forEach((t) => combinedStream.addTrack(t));
      } else if (screenAudioTracks.length > 0) {
        screenAudioTracks.forEach((t) => combinedStream.addTrack(t));
      } else if (localStreamRef.current && localStreamRef.current.getAudioTracks().length > 0 && !nextMuted) {
        localStreamRef.current.getAudioTracks().forEach((t) => combinedStream.addTrack(t));
      }

      clientRef.current?.setLocalStream(combinedStream);
      setParticipants((prev) =>
        prev.map((p) => (p.isLocal ? { ...p, isMuted: nextMuted, stream: combinedStream } : p))
      );
    } else {
      if (localStreamRef.current) {
        clientRef.current?.setLocalStream(localStreamRef.current);
      }
      setParticipants((prev) =>
        prev.map((p) => (p.isLocal ? { ...p, isMuted: nextMuted, stream: localStreamRef.current || undefined } : p))
      );
    }

    clientRef.current?.updateStatus({ isMuted: nextMuted });
  };

  const toggleVideo = async () => {
    const nextVideoOff = !isVideoOff;
    setIsVideoOff(nextVideoOff);

    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      if (videoTracks.length > 0) {
        videoTracks.forEach((track) => {
          track.enabled = !nextVideoOff;
        });
      } else if (!nextVideoOff) {
        try {
          const newVideoStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          });
          const newTrack = newVideoStream.getVideoTracks()[0];
          if (newTrack) {
            localStreamRef.current.addTrack(newTrack);
          }
        } catch (err) {
          console.warn('Could not acquire video track:', err);
        }
      }
    } else if (!nextVideoOff) {
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: !isMuted,
        });
        localStreamRef.current = newStream;
      } catch (err) {
        console.warn('Could not initialize video stream:', err);
      }
    }

    if (isScreenSharing && screenStreamRef.current) {
      wasVideoOffRef.current = nextVideoOff;
    } else {
      if (localStreamRef.current) {
        clientRef.current?.setLocalStream(localStreamRef.current);
      }
      setParticipants((prev) =>
        prev.map((p) => (p.isLocal ? { ...p, isVideoOff: nextVideoOff, stream: localStreamRef.current || undefined } : p))
      );
      clientRef.current?.updateStatus({ isVideoOff: nextVideoOff });
    }
  };

  const toggleScreenShare = async () => {
    if (!isHost && !screenShareEnabled && !isScreenSharing) {
      showNotification('Attendee screen sharing is paused by the facilitator.');
      return;
    }

    if (isScreenSharing) {
      if (screenAudioMixerRef.current) {
        screenAudioMixerRef.current.cleanup();
        screenAudioMixerRef.current = null;
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      setIsScreenSharing(false);
      const restoredVideoOff = wasVideoOffRef.current;
      setIsVideoOff(restoredVideoOff);

      if (localStreamRef.current) {
        clientRef.current?.setLocalStream(localStreamRef.current);
        setParticipants((prev) =>
          prev.map((p) =>
            p.isLocal
              ? { ...p, stream: localStreamRef.current || undefined, isScreenSharing: false, isVideoOff: restoredVideoOff }
              : p
          )
        );
      }
      clientRef.current?.updateStatus({ isScreenSharing: false, isVideoOff: restoredVideoOff });
      if (pinnedUserId === userId) {
        setPinnedUserId(null);
      }
      showNotification('Screen sharing stopped');
    } else {
      try {
        wasVideoOffRef.current = isVideoOff;

        let screenStream: MediaStream;
        try {
          screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              cursor: 'always',
            } as any,
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            } as any,
            systemAudio: 'include',
            selfBrowserSurface: 'include',
          } as any);
        } catch (e) {
          screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: 'always' } as any,
            audio: true,
          });
        }

        screenStreamRef.current = screenStream;
        setIsScreenSharing(true);
        setIsVideoOff(false);

        const combinedStream = new MediaStream();
        screenStream.getVideoTracks().forEach((t) => combinedStream.addTrack(t));

        const screenAudioTracks = screenStream.getAudioTracks();
        const micAudioTracks = localStreamRef.current
          ? localStreamRef.current.getAudioTracks().filter((t) => t.enabled && t.readyState === 'live')
          : [];

        if (screenAudioMixerRef.current) {
          screenAudioMixerRef.current.cleanup();
          screenAudioMixerRef.current = null;
        }

        if (screenAudioTracks.length > 0 && micAudioTracks.length > 0 && !isMuted) {
          const mixer = createMixedAudioStream([screenStream, localStreamRef.current!]);
          screenAudioMixerRef.current = mixer;
          mixer.mixedStream.getAudioTracks().forEach((t) => combinedStream.addTrack(t));
        } else if (screenAudioTracks.length > 0) {
          screenAudioTracks.forEach((t) => combinedStream.addTrack(t));
        } else if (localStreamRef.current && localStreamRef.current.getAudioTracks().length > 0 && !isMuted) {
          localStreamRef.current.getAudioTracks().forEach((t) => combinedStream.addTrack(t));
        }

        clientRef.current?.setLocalStream(combinedStream);

        setParticipants((prev) =>
          prev.map((p) =>
            p.isLocal
              ? { ...p, stream: combinedStream, isScreenSharing: true, isVideoOff: false }
              : p
          )
        );
        clientRef.current?.updateStatus({ isScreenSharing: true, isVideoOff: false });
        setPinnedUserId(userId);
        showNotification('You are sharing your screen');

        const videoTrack = screenStream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.onended = () => {
            if (screenAudioMixerRef.current) {
              screenAudioMixerRef.current.cleanup();
              screenAudioMixerRef.current = null;
            }
            if (screenStreamRef.current) {
              screenStreamRef.current.getTracks().forEach((t) => t.stop());
              screenStreamRef.current = null;
            }
            setIsScreenSharing(false);
            const restoredVideoOff = wasVideoOffRef.current;
            setIsVideoOff(restoredVideoOff);

            if (localStreamRef.current) {
              clientRef.current?.setLocalStream(localStreamRef.current);
              setParticipants((prev) =>
                prev.map((p) =>
                  p.isLocal
                    ? { ...p, stream: localStreamRef.current || undefined, isScreenSharing: false, isVideoOff: restoredVideoOff }
                    : p
                )
              );
            }
            clientRef.current?.updateStatus({ isScreenSharing: false, isVideoOff: restoredVideoOff });
            setPinnedUserId(null);
            showNotification('Screen sharing ended');
          };
        }
      } catch (err) {
        console.warn('Screen share cancelled:', err);
      }
    }
  };

  useEffect(() => {
    if (clientRef.current) {
      clientRef.current.setHost(isHost);
    }
  }, [isHost]);

  const toggleHandRaise = () => {
    const nextState = !handRaised;
    setHandRaised(nextState);
    setParticipants((prev) =>
      prev.map((p) => (p.isLocal ? { ...p, handRaised: nextState } : p))
    );
    clientRef.current?.updateStatus({ handRaised: nextState });
  };

  const lastReactionTimeRef = useRef<number>(0);
  const handleSendReaction = (emoji: string) => {
    const now = Date.now();
    if (now - lastReactionTimeRef.current < 400) return;
    lastReactionTimeRef.current = now;

    const reactionId = 'react_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const newReaction: ReactionItem = {
      id: reactionId,
      senderId: userId,
      senderName: userName,
      emoji,
    };
    setActiveReactions((prev) => {
      if (prev.some((r) => r.id === reactionId)) return prev;
      return [...prev, newReaction];
    });
    clientRef.current?.sendReaction(emoji, reactionId);
    setTimeout(() => {
      setActiveReactions((prev) => prev.filter((r) => r.id !== reactionId));
    }, 3200);
  };

  const startRecording = async () => {
    if (!isHost) {
      alert('Only the host can record.');
      return;
    }

    try {
      const remoteStreams = participants
        .filter((p) => !p.isLocal && p.stream)
        .map((p) => p.stream!);

      const rec = new LocalMeetingRecorder({
        roomId,
        mode: 'composite',
        localStream: localStreamRef.current,
        remoteStreams,
        getParticipants: () => {
          return participantsRef.current.map((p) => ({
            id: p.id,
            name: p.name,
            isMuted: p.isMuted,
            isVideoOff: p.isVideoOff,
            stream: p.stream,
            isScreenSharing: p.isScreenSharing,
          }));
        },
        getVideoElements: () => {
          return participantsRef.current.map((p) => ({
            id: p.id,
            name: p.name,
            element: videoElementsRef.current.get(p.id) || null,
            isMuted: p.isMuted,
          }));
        },
        onTick: (duration: number, size: number) => {
          setRecordingDuration(duration);
          setRecordingSizeBytes(size);
        },
        onStatusChange: (status: 'recording' | 'paused' | 'stopped') => {
          setRecordingStatus(status);
        },
      });

      await rec.start();
      setRecorder(rec);
      setRecordingStatus('recording');
      clientRef.current?.notifyRecording(true);
      showNotification('Recording started');
    } catch (err) {
      console.error('Error starting recording:', err);
      alert('Unable to start recording. Ensure permissions are granted.');
    }
  };

  const stopRecording = async () => {
    if (!recorder) return;
    try {
      const result = await recorder.stop();
      setRecorder(null);
      setRecordingStatus('idle');
      setLastFinishedRecording(result);
      clientRef.current?.notifyRecording(false);
      showNotification('Recording ready');
    } catch (err) {
      console.error('Error stopping recording:', err);
    }
  };

  const sendChatMessage = (text: string) => {
    clientRef.current?.sendChatMessage(text);
  };

  // Facilitator Moderation Handlers
  const handleMuteAll = () => {
    clientRef.current?.hostMuteAll();
    setParticipants((prev) => prev.map((p) => (!p.isLocal ? { ...p, isMuted: true } : p)));
    showNotification('Muted all attendee microphones');
  };

  const handleMuteUser = (targetUserId: string) => {
    clientRef.current?.hostMuteUser(targetUserId);
    setParticipants((prev) => prev.map((p) => (p.id === targetUserId ? { ...p, isMuted: true } : p)));
    showNotification('Microphone muted for attendee');
  };

  const handleUnmuteUser = (targetUserId: string) => {
    clientRef.current?.hostUnmuteUser(targetUserId);
    setParticipants((prev) => prev.map((p) => (p.id === targetUserId ? { ...p, isMuted: false } : p)));
    showNotification('Microphone unmuted for attendee');
  };

  const handleStopVideoUser = (targetUserId: string) => {
    clientRef.current?.hostStopVideo(targetUserId);
    setParticipants((prev) => prev.map((p) => (p.id === targetUserId ? { ...p, isVideoOff: true } : p)));
    showNotification('Camera turned off for attendee');
  };

  const handleStartVideoUser = (targetUserId: string) => {
    clientRef.current?.hostStartVideo(targetUserId);
    setParticipants((prev) => prev.map((p) => (p.id === targetUserId ? { ...p, isVideoOff: false } : p)));
    showNotification('Camera turned on for attendee');
  };

  const handleStopAllVideo = () => {
    clientRef.current?.hostStopAllVideo();
    setParticipants((prev) => prev.map((p) => (!p.isLocal ? { ...p, isVideoOff: true } : p)));
    showNotification('Turned off all attendee cameras');
  };

  const handleLowerHand = (targetUserId: string) => {
    clientRef.current?.hostLowerHand(targetUserId);
    setParticipants((prev) => prev.map((p) => (p.id === targetUserId ? { ...p, handRaised: false } : p)));
  };

  const handleLowerAllHands = () => {
    clientRef.current?.hostLowerAllHands();
    setHandRaised(false);
    setParticipants((prev) => prev.map((p) => ({ ...p, handRaised: false })));
    showNotification('Lowered all hands');
  };

  const handleSpotlightUser = (targetUserId: string | null) => {
    setPinnedUserId(targetUserId);
    clientRef.current?.hostSpotlight(targetUserId);
  };

  const handleToggleSpeaker = (targetUserId: string) => {
    const target = participants.find((p) => p.id === targetUserId);
    const nextIsSpeaker = !target?.isSpeaker;
    setParticipants((prev) =>
      prev.map((p) => (p.id === targetUserId ? { ...p, isSpeaker: nextIsSpeaker } : p))
    );
    clientRef.current?.hostToggleSpeaker(targetUserId, nextIsSpeaker);
    if (target) {
      showNotification(
        nextIsSpeaker
          ? `${target.name} assigned as Speaker`
          : `${target.name} removed from Speaker Stage`
      );
    }
  };

  const handleToggleCoModerator = (targetUserId: string) => {
    const target = participants.find((p) => p.id === targetUserId);
    if (!target) return;
    const nextCoMod = !target.isCoModerator;
    setParticipants((prev) =>
      prev.map((p) => (p.id === targetUserId ? { ...p, isCoModerator: nextCoMod } : p))
    );
    clientRef.current?.hostToggleCoModerator(targetUserId, nextCoMod);
    showNotification(
      nextCoMod
        ? `${target.name} appointed as Co-Moderator`
        : `${target.name} removed from Co-Moderator role`
    );
  };

  const handleToggleLock = () => {
    const nextLocked = !isLocked;
    setIsLocked(nextLocked);
    clientRef.current?.hostToggleLock(nextLocked);
    showNotification(nextLocked ? 'Sanctuary locked to new entries' : 'Sanctuary unlocked');
  };

  const handleToggleChatPermission = (enabled: boolean) => {
    setChatEnabled(enabled);
    clientRef.current?.hostSetChatPermission(enabled);
    showNotification(enabled ? 'Discussion chat enabled' : 'Discussion chat paused by moderator');
  };

  const handleToggleScreenSharePermission = (enabled: boolean) => {
    setScreenShareEnabled(enabled);
    clientRef.current?.hostSetScreenSharePermission(enabled);
    showNotification(enabled ? 'Attendee screen sharing enabled' : 'Screen sharing restricted to moderator');
  };

  const handleBroadcastAnnouncement = (text: string) => {
    clientRef.current?.hostBroadcastAnnouncement(text);
    setStageAnnouncement({ text, senderName: userName });
    showNotification('Announcement broadcast to all seekers');
  };

  const handleTransferHost = (targetUserId: string) => {
    clientRef.current?.hostTransfer(targetUserId);
    setIsHost(false);
    showNotification('Facilitator role transferred');
  };

  const handleKickUser = (targetUserId: string) => {
    clientRef.current?.hostKickUser(targetUserId);
    setParticipants((prev) => prev.filter((p) => p.id !== targetUserId));
    showNotification('Attendee removed from Majlis');
  };

  const handleEndMeetingForAll = () => {
    if (recorder) {
      recorder.stop().catch(console.warn);
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
    }
    clientRef.current?.hostEndSession();
    clientRef.current?.leave();
    onEndOrLeaveMeeting(roomId);
  };

  const copyMeetingLink = async () => {
    const inviteUrl = buildMeetingInviteUrl(roomId, currentTitle, appUrl);
    const success = await copyTextToClipboard(inviteUrl);
    if (success) {
      setCopiedLink(true);
      showNotification('Link copied with session topic');
      setTimeout(() => setCopiedLink(false), 2000);
    } else {
      setShowInviteModal(true);
    }
  };

  const handleFinalExit = () => {
    setShowLeaveConfirmDialog(false);
    if (recorder) {
      recorder.stop().catch(console.warn);
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (isHost || participants.length <= 1) {
      clientRef.current?.hostEndSession();
    }
    clientRef.current?.leave();
    onEndOrLeaveMeeting(roomId);
  };

  const pinnedParticipant = participants.find((p) => p.id === pinnedUserId);
  const otherParticipants = participants.filter((p) => p.id !== pinnedUserId);

  return (
    <div className="relative w-screen h-screen bg-[#140F0C] text-[#FFFCF5] flex flex-col overflow-hidden select-none font-sans">
      {/* Toast Notification */}
      {systemBanner && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-3.5 py-1.5 bg-[#2B1706] border border-[#302116] text-[#E0C2A6] text-xs font-medium rounded-sm shadow-md flex items-center gap-2 animate-in fade-in">
          <Info className="w-3.5 h-3.5 text-[#E9A83A]" />
          <span>{systemBanner}</span>
        </div>
      )}

      {/* TOP COMPACT HEADER */}
      {!isScreenMaximized && (
        <header className="h-12 sm:h-13 px-2.5 sm:px-4 md:px-5 bg-[#160E09]/95 backdrop-blur-md border-b border-[#302116] flex items-center justify-between z-20 shrink-0 shadow-md gap-1.5 sm:gap-3">
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
          <IslamicStarRosette size={22} variant="full" className="shrink-0" />
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <span className="text-[10px] uppercase font-bold tracking-[0.22em] text-[#D9C6B0] hidden md:flex items-center gap-1.5 shrink-0">
              <span>THE WISDOM LOUNGE</span>
              <span className="text-[#E9A83A]">✦</span>
            </span>
            <span className="text-xs font-bold text-[#FFFCF5] shrink-0">Majlis</span>
            <button
              onClick={copyMeetingLink}
              className="flex items-center gap-1 px-2 py-1 bg-[#20150E] hover:bg-[#2B1C13] text-[#E9A83A] rounded-sm border border-[#3A2619] text-[11px] font-mono transition-colors shadow-xs shrink-0"
              title="Copy Majlis Link"
            >
              <span className="whitespace-nowrap">{roomId}</span>
              {copiedLink ? <Check className="w-3 h-3 text-[#19A6A0]" /> : <Copy className="w-3 h-3 text-[#8A7A6D]" />}
            </button>
          </div>

          {currentTitle && (
            <div className="hidden lg:flex items-center gap-2 pl-3 border-l border-[#302116] min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-[#E9A83A] shrink-0" />
              <span className="text-xs font-semibold text-[#FFFCF5] bg-[#22160E] border border-[#3A2619] px-2 py-0.5 rounded-sm max-w-[180px] truncate">
                {currentTitle}
              </span>
            </div>
          )}

          {isLocked && (
            <span className="px-1.5 py-0.5 text-[9px] font-bold bg-[#A83245]/20 text-[#E9A83A] border border-[#A83245]/60 rounded-sm flex items-center gap-1 shrink-0">
              <Lock className="w-2.5 h-2.5 text-[#E9A83A]" /> <span className="hidden xs:inline">Locked</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 sm:gap-2 text-xs shrink-0">
          {/* Moderator Hub Quick Badge */}
          {isHost && (
            <button
              onClick={() => setShowModeratorHub(true)}
              className="flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 bg-[#075E4A] hover:bg-[#05493A] border border-[#19A6A0]/50 rounded-sm text-[#FFFCF5] font-semibold transition-colors shadow-xs shrink-0"
              title="Open Moderator Control Center"
            >
              <Crown className="w-3.5 h-3.5 text-[#E9A83A]" />
              <span className="text-xs hidden sm:inline whitespace-nowrap">Moderator Hub</span>
            </button>
          )}

          {/* Participant Count */}
          <button
            onClick={() => setActiveDrawer(activeDrawer === 'participants' ? null : 'participants')}
            className="flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1.5 bg-[#20150E] hover:bg-[#2B1C13] border border-[#3A2619] rounded-sm text-[#FFFCF5] text-xs font-mono transition-colors shadow-xs shrink-0"
            title="View participants"
          >
            <Users className="w-3.5 h-3.5 text-[#E9A83A]" />
            <span className="font-semibold text-[#FFFCF5]">{participants.length}</span>
          </button>

          {/* Duration & Status */}
          <div className="flex items-center gap-1 text-[#E9A83A] font-mono text-[11px] sm:text-xs px-2 py-1 sm:px-2.5 sm:py-1.5 bg-[#20150E] border border-[#3A2619] rounded-sm shadow-xs shrink-0">
            <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-[#19A6A0] animate-pulse" />
            <span>{formatTime(meetingSeconds)}</span>
          </div>


        </div>
      </header>
      )}

      {/* STAGE ANNOUNCEMENT BANNER */}
      {stageAnnouncement && (
        <div className="bg-gradient-to-r from-[#2B1706] via-[#3C230B] to-[#2B1706] border-b border-[#E9A83A]/40 px-4 py-2 flex items-center justify-between z-20 animate-in slide-in-from-top duration-200 shadow-md">
          <div className="flex items-center gap-2.5 text-xs text-[#FFFCF5]">
            <Radio className="w-4 h-4 text-[#E9A83A] shrink-0 animate-pulse" />
            <span className="font-bold text-[#E9A83A] uppercase text-[10px] tracking-wider">
              {stageAnnouncement.senderName ? `${stageAnnouncement.senderName}:` : 'Moderator Notice:'}
            </span>
            <span className="font-medium text-[#FFFCF5]">{stageAnnouncement.text}</span>
          </div>
          <button
            onClick={() => setStageAnnouncement(null)}
            className="p-1 text-[#E9A83A]/70 hover:text-white rounded-sm transition"
            title="Dismiss Notice"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* MAIN VIDEO STAGE */}
      <div className="flex-1 flex overflow-hidden relative bg-[#100A06]">
        {/* Atmospheric Stained Glass Architectural Background with Clear Sanctuary View */}
        <div className="absolute inset-0 z-0 pointer-events-none select-none overflow-hidden">
          <img
            src={heroStainedGlassImg}
            alt="Majlis Sanctuary"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover brightness-[0.70] contrast-[1.08] filter blur-[0.5px]"
          />
          {/* Subtle warm bronze & emerald architectural overlay scrim */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#160E09]/75 via-[#100A06]/55 to-[#0A0503]/80" />

          {/* Delicate Geometric Girih Leaded Glass Overlay Grid */}
          <svg className="absolute inset-0 w-full h-full opacity-20 pointer-events-none stroke-[#E9A83A]" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="meeting-girih-pattern" width="80" height="80" patternUnits="userSpaceOnUse">
                <path d="M40 0 L80 40 L40 80 L0 40 Z" fill="none" strokeWidth="1" strokeOpacity="0.4" />
                <path d="M40 10 L70 40 L40 70 L10 40 Z" fill="none" strokeWidth="0.75" strokeOpacity="0.3" stroke="#075E4A" />
                <path d="M0 0 L80 80 M80 0 L0 80" fill="none" strokeWidth="0.5" strokeOpacity="0.25" stroke="#E9A83A" />
                <circle cx="40" cy="40" r="6" fill="none" strokeWidth="0.75" strokeOpacity="0.4" stroke="#E9A83A" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#meeting-girih-pattern)" />
          </svg>

          {/* Ambient warm jewel glass radial light in center of stage */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[850px] h-[520px] bg-gradient-to-r from-[#E9A83A]/15 via-[#075E4A]/20 to-[#174A83]/15 blur-3xl pointer-events-none rounded-full" />
        </div>

        {/* Floating Animated Emoji Reactions */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-30">
          {activeReactions.map((reaction, index) => {
            const leftPercent = 15 + ((reaction.id.charCodeAt(reaction.id.length - 1) * 7 + index * 17) % 70);
            return (
              <div
                key={reaction.id}
                className="absolute bottom-20 flex flex-col items-center animate-float-up pointer-events-none select-none"
                style={{
                  left: `${leftPercent}%`,
                }}
              >
                <span className="text-4xl sm:text-5xl filter drop-shadow-lg transform transition-transform">
                  {reaction.emoji}
                </span>
                <span className="text-[10px] sm:text-[11px] font-semibold text-[#FFFCF5] bg-[#1A110B] border border-[#302116] px-2.5 py-0.5 rounded-sm mt-1 shadow-md">
                  {reaction.senderName}
                </span>
              </div>
            );
          })}
        </div>

        <main className="flex-1 p-4 sm:p-6 flex items-center justify-center overflow-hidden relative z-10">
          {(() => {
            const screenSharer = participants.find((p) => p.isScreenSharing);
            if (screenSharer) {
              const otherParticipants = participants.filter((p) => p.id !== screenSharer.id);
              return (
                <div className={`flex flex-col gap-3 ${isScreenMaximized ? 'fixed inset-0 z-50 bg-[#120B07] p-6' : 'w-full h-full'}`}>
                  <div className="flex items-center justify-between bg-[#1C130C] border border-[#3A2619] px-4 py-2 rounded-sm shrink-0 shadow-md">
                    <div className="flex items-center gap-2 text-xs text-[#FFFCF5]">
                      <MonitorUp className="w-4 h-4 text-[#19A6A0]" />
                      <span className="font-bold text-[#FFFCF5]">{screenSharer.name}'s Screen Share</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setIsScreenMaximized(!isScreenMaximized)}
                        className="p-1.5 px-3 rounded-sm bg-[#075E4A] hover:bg-[#05493A] text-white transition-colors flex items-center gap-1.5 text-xs font-semibold"
                        title={isScreenMaximized ? 'Minimize Screen Share' : 'Maximize Screen Share'}
                      >
                        {isScreenMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                        <span>{isScreenMaximized ? 'Minimize' : 'Maximize'}</span>
                      </button>
                    </div>
                  </div>

                   <div className="flex-1 bg-black rounded-sm overflow-hidden relative border border-[#3A2619] shadow-2xl flex items-center justify-center min-h-0">
                    <video
                      ref={(el) => {
                        screenVideoRef.current = el;
                        if (el && screenSharer.stream) {
                          if (el.srcObject !== screenSharer.stream) {
                            el.srcObject = screenSharer.stream;
                          }
                          el.play().catch(() => {});
                        }
                        if (el) videoElementsRef.current.set(screenSharer.id, el);
                      }}
                      autoPlay
                      playsInline
                      muted={true}
                      className="w-full h-full object-contain bg-black"
                    />
                  </div>

                  {/* Thin Bottom Ribbon Participants List */}
                  {participants.length > 0 && (
                    <div className="h-16 sm:h-20 bg-[#160E09]/95 backdrop-blur-md border border-[#3A2619] rounded-sm px-3 py-1.5 flex items-center gap-3 overflow-x-auto shrink-0 shadow-xl scrollbar-thin">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#E9A83A] uppercase tracking-wider shrink-0 pr-2 border-r border-[#3A2619]">
                        <Users className="w-3.5 h-3.5" />
                        <span>({participants.length})</span>
                      </div>
                      <div className="flex items-center gap-2 overflow-x-auto flex-1 min-w-0">
                        {participants.map((p) => (
                          <div
                            key={p.id}
                            className={`flex items-center gap-2 px-2.5 py-1 rounded-sm bg-[#1F140D] border shrink-0 transition-colors ${
                              p.id === screenSharer.id
                                ? 'border-[#19A6A0] bg-[#075E4A]/30'
                                : 'border-[#3A2619] hover:border-[#E9A83A]/50'
                            }`}
                          >
                            <div className="w-6 h-6 rounded-full bg-[#075E4A] border border-[#19A6A0]/50 flex items-center justify-center font-bold text-[11px] text-[#FFFCF5] shrink-0 relative">
                              {p.name.charAt(0).toUpperCase()}
                              {p.handRaised && (
                                <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-[#E9A83A] text-[#1E140C] flex items-center justify-center border border-[#160E09]">
                                  <Hand className="w-2 h-2" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 text-left">
                              <div className="flex items-center gap-1">
                                <span className="font-semibold text-xs text-[#FFFCF5] truncate max-w-[90px]">
                                  {p.name}
                                </span>
                                {p.isLocal && <span className="text-[9px] text-[#8A7A6D]">(You)</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 ml-1">
                              <div className={`p-0.5 rounded-sm ${p.isMuted ? 'text-[#A83245]' : 'text-[#19A6A0]'}`}>
                                {p.isMuted ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                              </div>
                              <div className={`p-0.5 rounded-sm ${p.isVideoOff ? 'text-[#A83245]' : 'text-[#8A7A6D]'}`}>
                                {p.isVideoOff ? <VideoOff className="w-3 h-3" /> : <Video className="w-3 h-3" />}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            const assignedSpeakers = participants.filter((p) => p.isSpeaker);
            const speakersOnStage = assignedSpeakers.length > 0
              ? assignedSpeakers
              : participants.filter((p) => p.isHost);
            const regularHoneycombParticipants = participants.filter(
              (p) => !speakersOnStage.some((s) => s.id === p.id)
            );

            return (
               /* Side-by-Side Honeycomb Stage View (Left: Arc Door Speakers | Right: Honeycomb Assembly) */
              <div className="w-full h-full flex flex-col lg:flex-row items-center justify-between overflow-y-auto py-2 px-2 sm:px-4 max-w-7xl mx-auto gap-4 lg:gap-6 scrollbar-thin">
                {/* LEFT SIDE: ELEVATED SPEAKER STAGE AREA */}
                <div className="w-full lg:w-1/2 h-full flex flex-col items-center justify-center min-h-0 sm:min-h-[240px] lg:min-h-[360px] p-1 sm:p-2">
                  {/* Star Medallion Portals on Left Side */}
                  <div className="flex-1 w-full flex flex-wrap items-center justify-center gap-3 sm:gap-6 max-h-[75vh] overflow-y-auto p-1">
                    {speakersOnStage.map((speaker) => (
                      <div
                        key={speaker.id}
                        className={`transition-all duration-300 flex items-center justify-center ${
                          speakersOnStage.length === 1
                            ? 'w-40 sm:w-56 md:w-72 lg:w-80 aspect-square'
                            : speakersOnStage.length === 2
                            ? 'w-32 sm:w-44 md:w-60 aspect-square'
                            : 'w-28 sm:w-36 aspect-square'
                        }`}
                      >
                        <VideoTile
                          participant={speaker}
                          isLocal={speaker.isLocal}
                          mirror={mirrorVideo}
                          canModerate={canModerate}
                          onMuteUser={handleMuteUser}
                          onUnmuteUser={handleUnmuteUser}
                          onStopVideoUser={handleStopVideoUser}
                          onStartVideoUser={handleStartVideoUser}
                          forceShape="star-medallion"
                          onTogglePin={() => {}}
                          videoRefCallback={(el) => {
                            if (el) videoElementsRef.current.set(speaker.id, el);
                            else videoElementsRef.current.delete(speaker.id);
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* ARCHITECTURAL DIVIDER (Vertical on Desktop, Horizontal on Mobile) */}
                <div className="hidden lg:flex flex-col items-center justify-center gap-3 self-stretch shrink-0 px-2 py-4">
                  <div className="w-0.5 flex-1 bg-gradient-to-b from-transparent via-[#E9A83A]/50 to-transparent" />
                  <IslamicStarRosette variant="gold-outline" size={18} />
                  <div className="w-0.5 flex-1 bg-gradient-to-b from-transparent via-[#E9A83A]/50 to-transparent" />
                </div>

                <div className="lg:hidden w-full flex items-center justify-center gap-3 my-1.5 sm:my-2 shrink-0">
                  <div className="h-0.5 flex-1 bg-gradient-to-r from-transparent via-[#E9A83A]/50 to-transparent" />
                  <IslamicStarRosette variant="gold-outline" size={14} />
                  <div className="h-0.5 flex-1 bg-gradient-to-r from-transparent via-[#E9A83A]/50 to-transparent" />
                </div>

                {/* RIGHT SIDE: REGULAR PARTICIPANTS HONEYCOMB ASSEMBLY */}
                <div className="w-full lg:w-1/2 h-full flex flex-col items-center justify-center min-h-0 sm:min-h-[240px] lg:min-h-[360px] p-1 sm:p-2">
                  <div className="flex-1 w-full flex items-center justify-center max-h-[75vh] overflow-y-auto p-1">
                    {regularHoneycombParticipants.length > 0 ? (
                      <HoneycombGrid
                        participants={regularHoneycombParticipants}
                        mirrorVideo={mirrorVideo}
                        canModerate={canModerate}
                        onMuteUser={handleMuteUser}
                        onUnmuteUser={handleUnmuteUser}
                        onStopVideoUser={handleStopVideoUser}
                        onStartVideoUser={handleStartVideoUser}
                        onPinUser={() => {}}
                        videoElementsRef={videoElementsRef}
                      />
                    ) : (
                      <div className="p-5 rounded-sm bg-[#1A110B]/85 border border-[#302116] text-center text-xs text-[#8E7E73] max-w-sm shadow-lg">
                        <IslamicStarRosette size={24} variant="gold-outline" className="mx-auto mb-2 opacity-75" />
                        <p className="font-semibold text-[#D9C6B0]">All attendees are currently on the Speaker Stage</p>
                        <p className="text-[11px] text-[#8A7A6D] mt-1.5">New seekers entering the sanctuary will populate this honeycomb assembly on the right.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Persistent Remote Audio Bridge ensuring audio is always audible for all attendees and screen shares across tab switches */}
          <div className="absolute top-0 left-0 w-0 h-0 overflow-hidden opacity-0 pointer-events-none" aria-hidden="true">
            {participants
              .filter((p) => !p.isLocal && p.stream)
              .map((p) => (
                <audio
                  key={`audio-bridge-${p.id}`}
                  ref={(el) => {
                    if (el && p.stream) {
                      if (el.srcObject !== p.stream) {
                        el.srcObject = p.stream;
                      }
                      el.play().catch(() => {});
                    }
                  }}
                  autoPlay
                  playsInline
                />
              ))}
          </div>
        </main>

        {/* Side Panels */}
        {activeDrawer === 'chat' && (
          <ChatDrawer
            messages={messages}
            currentUserId={userId}
            isHost={isHost}
            chatEnabled={chatEnabled}
            onSendMessage={sendChatMessage}
            onClose={() => setActiveDrawer(null)}
          />
        )}

        {activeDrawer === 'participants' && (
          <ParticipantsDrawer
            participants={participants}
            currentUserId={userId}
            isHost={isHost}
            canModerate={canModerate}
            isPrimaryHost={isHost}
            isLocked={isLocked}
            spotlightUserId={pinnedUserId}
            onMuteAll={handleMuteAll}
            onStopAllVideo={handleStopAllVideo}
            onToggleLock={handleToggleLock}
            onMuteUser={handleMuteUser}
            onUnmuteUser={handleUnmuteUser}
            onStopVideoUser={handleStopVideoUser}
            onStartVideoUser={handleStartVideoUser}
            onLowerHand={handleLowerHand}
            onSpotlightUser={handleSpotlightUser}
            onToggleSpeaker={handleToggleSpeaker}
            onToggleCoModerator={handleToggleCoModerator}
            onTransferHost={handleTransferHost}
            onKickUser={handleKickUser}
            onOpenFacilitatorHub={() => setShowModeratorHub(true)}
            onOpenInvite={() => setShowInviteModal(true)}
            onClose={() => setActiveDrawer(null)}
          />
        )}
      </div>

      {/* BOTTOM CONTROL BAR */}
      {!isScreenMaximized && (
        <footer className="h-14 sm:h-16 bg-[#160E09]/95 backdrop-blur-lg border-t border-[#302116] px-2 sm:px-4 md:px-6 flex items-center justify-between z-30 shrink-0 shadow-2xl gap-1 sm:gap-2">
        {/* Left Audio & Video Controls */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <button
            onClick={toggleAudio}
            className={`flex items-center justify-center gap-1.5 p-2 sm:px-3.5 sm:py-2.5 rounded-sm text-xs font-semibold transition-all shadow-xs ${
              isMuted
                ? 'bg-[#A83245] hover:bg-[#8B2334] text-white border border-[#C44056]'
                : 'bg-[#075E4A] hover:bg-[#05493A] text-[#FFFCF5] border border-[#19A6A0]/50'
            }`}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-[#19A6A0]" />}
            <span className="hidden md:inline">{isMuted ? 'Unmute' : 'Mute'}</span>
          </button>

          <button
            onClick={toggleVideo}
            className={`flex items-center justify-center gap-1.5 p-2 sm:px-3.5 sm:py-2.5 rounded-sm text-xs font-semibold transition-all shadow-xs ${
              isVideoOff
                ? 'bg-[#A83245] hover:bg-[#8B2334] text-white border border-[#C44056]'
                : 'bg-[#075E4A] hover:bg-[#05493A] text-[#FFFCF5] border border-[#19A6A0]/50'
            }`}
            title={isVideoOff ? 'Start Video' : 'Stop Video'}
          >
            {isVideoOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4 text-[#19A6A0]" />}
            <span className="hidden md:inline">{isVideoOff ? 'Start Video' : 'Stop Video'}</span>
          </button>
        </div>

        {/* Center Controls Dock */}
        <div className="flex items-center gap-0.5 sm:gap-1 p-0.5 sm:p-1 bg-[#1F140D] border border-[#3A2619] rounded-sm shadow-inner shrink min-w-0">
          {/* Screen Share */}
          <button
            onClick={toggleScreenShare}
            className={`p-2 sm:p-2.5 rounded-sm border text-xs transition-colors flex items-center justify-center ${
              isScreenSharing
                ? 'bg-[#075E4A] text-white border-[#19A6A0]'
                : 'bg-transparent text-[#FAF8F5] border-transparent hover:bg-[#2B1B12]'
            }`}
            title={!isHost && !screenShareEnabled ? 'Screen share disabled by moderator' : 'Screen Share'}
          >
            <MonitorUp className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          {/* Emoji Reactions */}
          <div className="relative">
            <button
              onClick={() => setShowReactionPicker((prev) => !prev)}
              className={`p-2 sm:p-2.5 rounded-sm border text-xs transition-colors flex items-center justify-center gap-1 ${
                showReactionPicker
                  ? 'bg-[#075E4A] text-[#E9A83A] border-[#E9A83A]'
                  : 'bg-transparent text-[#FAF8F5] border-transparent hover:bg-[#2B1B12]'
              }`}
              title="Reactions"
            >
              <Smile className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#E9A83A]" />
              <span className="hidden lg:inline font-medium text-xs">React</span>
            </button>

            {showReactionPicker && (
              <ReactionPicker
                onSelectReaction={(emoji) => {
                  handleSendReaction(emoji);
                  setShowReactionPicker(false);
                }}
                onToggleHandRaise={() => {
                  toggleHandRaise();
                  setShowReactionPicker(false);
                }}
                handRaised={handRaised}
                onClose={() => setShowReactionPicker(false)}
              />
            )}
          </div>

          {/* Hand Raise */}
          <button
            onClick={toggleHandRaise}
            className={`p-2 sm:p-2.5 rounded-sm border text-xs transition-all flex items-center justify-center ${
              handRaised
                ? 'bg-[#E9A83A] text-[#1E140C] border-[#D4982E] font-bold shadow-[0_0_15px_rgba(233,168,58,0.5)]'
                : 'bg-transparent text-[#FAF8F5] border-transparent hover:bg-[#2B1B12]'
            }`}
            title={handRaised ? 'Lower Hand' : 'Raise Hand'}
          >
            <Hand className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          {/* Moderator Hub Toolbar Button */}
          {canModerate && (
            <button
              onClick={() => setShowModeratorHub(true)}
              className="p-2 sm:p-2.5 rounded-sm bg-[#075E4A] hover:bg-[#05493A] border border-[#19A6A0]/50 text-[#FFFCF5] text-xs font-medium transition-colors flex items-center justify-center gap-1 shadow-xs"
              title="Moderator Control Center"
            >
              <Crown className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#E9A83A]" />
              <span className="hidden lg:inline text-xs font-semibold">Hub</span>
            </button>
          )}

          {/* Recording (Host only, hidden on very narrow screens) */}
          {isHost && (
            recordingStatus === 'idle' ? (
              <button
                onClick={startRecording}
                className="p-2 sm:p-2.5 rounded-sm bg-transparent text-[#FAF8F5] hover:bg-[#2B1B12] transition-colors hidden sm:flex items-center justify-center"
                title="Record Session"
              >
                <Square className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#A83245]" />
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="px-2 py-1 bg-[#A83245] text-white text-[10px] font-bold rounded-sm border border-[#C44056] animate-pulse"
              >
                REC
              </button>
            )
          )}

          {/* Participants */}
          <button
            onClick={() => setActiveDrawer(activeDrawer === 'participants' ? null : 'participants')}
            className={`p-2 sm:p-2.5 rounded-sm border text-xs transition-colors relative flex items-center justify-center ${
              activeDrawer === 'participants' ? 'bg-[#075E4A] text-white border-[#19A6A0]' : 'bg-transparent text-[#FAF8F5] border-transparent hover:bg-[#2B1B12]'
            }`}
            title="Participants List"
          >
            <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#E9A83A]" />
            <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 bg-[#E9A83A] text-[#1E140C] rounded-sm text-[9px] font-mono font-bold flex items-center justify-center shadow-xs">
              {participants.length}
            </span>
          </button>

          {/* Chat */}
          <button
            onClick={() => { setActiveDrawer(activeDrawer === 'chat' ? null : 'chat'); setUnreadChatCount(0); }}
            className={`p-2 sm:p-2.5 rounded-sm border text-xs transition-colors relative flex items-center justify-center ${
              activeDrawer === 'chat' ? 'bg-[#075E4A] text-white border-[#19A6A0]' : 'bg-transparent text-[#FAF8F5] border-transparent hover:bg-[#2B1B12]'
            }`}
            title="Chat"
          >
            <MessageSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#19A6A0]" />
            {unreadChatCount > 0 && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-[#E9A83A] text-[#1E140C] rounded-sm text-[8px] font-bold flex items-center justify-center">
                {unreadChatCount}
              </span>
            )}
          </button>
        </div>

        {/* Leave Action — Jewel Ruby Button */}
        <div className="shrink-0">
          <button
            onClick={() => setShowLeaveConfirmDialog(true)}
            className="px-2.5 sm:px-4 py-2 sm:py-2.5 bg-[#A83245] hover:bg-[#8B2334] text-white rounded-sm text-[11px] sm:text-xs font-bold transition-all border border-[#7E1C2C] shadow-xs whitespace-nowrap"
          >
            {isHost ? 'End' : 'Leave'}
          </button>
        </div>
      </footer>
      )}

      {/* Confirmation Dialog */}
      {showLeaveConfirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-none">
          <div className="w-full max-w-xs bg-[#FFFCF5] border border-[#302116] rounded-sm p-5 text-center space-y-3 shadow-xl">
            <h3 className="text-base font-bold text-[#1C1917]">
              {isHost ? 'End Majlis?' : 'Leave Majlis?'}
            </h3>
            <p className="text-xs text-[#68594E]">
              {isHost
                ? 'Conclude this Majlis session for all seekers, or leave individually?'
                : 'Are you sure you want to exit the live room?'}
            </p>
            <div className="space-y-2 pt-2">
              <button
                onClick={handleFinalExit}
                className="w-full py-2 bg-[#A83245] hover:bg-[#8B2334] text-white rounded-sm text-xs font-semibold border border-[#7E1C2C]"
              >
                {isHost ? 'End Majlis for All' : 'Leave Majlis'}
              </button>
              <button
                onClick={() => setShowLeaveConfirmDialog(false)}
                className="w-full py-1.5 text-xs text-[#8E7E73]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Moderator Hub Modal */}
      {showModeratorHub && (
        <ModeratorHubModal
          isLocked={isLocked}
          chatEnabled={chatEnabled}
          screenShareEnabled={screenShareEnabled}
          participants={participants}
          spotlightUserId={pinnedUserId}
          isPrimaryHost={isHost}
          onToggleLock={handleToggleLock}
          onMuteAll={handleMuteAll}
          onStopAllVideo={handleStopAllVideo}
          onLowerAllHands={handleLowerAllHands}
          onToggleChatPermission={handleToggleChatPermission}
          onToggleScreenSharePermission={handleToggleScreenSharePermission}
          onClearSpotlight={() => handleSpotlightUser(null)}
          onToggleSpeaker={handleToggleSpeaker}
          onToggleCoModerator={handleToggleCoModerator}
          onBroadcastAnnouncement={handleBroadcastAnnouncement}
          onEndMeetingForAll={handleEndMeetingForAll}
          onClose={() => setShowModeratorHub(false)}
        />
      )}

      {/* Modals */}
      {lastFinishedRecording && (
        <RecordingModal recording={lastFinishedRecording} onClose={() => setLastFinishedRecording(null)} />
      )}
      {showInviteModal && (
        <InviteModal roomId={roomId} title={currentTitle} onClose={() => setShowInviteModal(false)} />
      )}
      {showSettingsModal && (
        <SettingsModal
          localStream={localStreamRef.current}
          mirrorVideo={mirrorVideo}
          onToggleMirror={setMirrorVideo}
          onClose={() => setShowSettingsModal(false)}
        />
      )}
    </div>
  );
};
