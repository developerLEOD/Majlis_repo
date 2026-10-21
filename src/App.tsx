import React, { useEffect, useState } from 'react';
import { Sidebar } from './components/navigation/Sidebar';
import { HomeScreen } from './components/home/HomeScreen';
import { MajalisScreen } from './components/majalis/MajalisScreen';
import { ProfileScreen } from './components/profile/ProfileScreen';
import { SettingsView } from './components/settings/SettingsView';
import { StartMajlisModal } from './components/majalis/StartMajlisModal';
import { PreJoinScreen } from './components/prejoin/PreJoinScreen';
import { MeetingRoom } from './components/MeetingRoom';
import { AuthModal } from './components/auth/AuthModal';
import { AuthProvider, useAuth } from './context/AuthContext';
import { MajlisSession, NavTab } from './types/meeting';
import {
  fetchAppConfig,
  getRoomInfoFromCurrentLocation,
  saveRoomTitleLocally,
  getRoomTitleLocally,
  getBackendApiUrl,
} from './utils/urlHelper';
import { useActiveMajalis, verifyMajlisOngoing } from './hooks/useActiveMajalis';
import { sessionSecurityStore } from './services/sessionSecurityStore';
import {
  createCloudRoom,
  DEFAULT_UPCOMING_SESSIONS,
  endCloudRoomSession,
  subscribeToScheduledSessions,
} from './services/firebaseMeetingSync';

function MainAppContent() {
  const { user, isModerator } = useAuth();
  const [currentTab, setCurrentTab] = useState<NavTab>('home');
  const [userName, setUserName] = useState<string>(() => {
    return localStorage.getItem('infinitymeet_username') || 'Araiz Hasan';
  });
  const [userId] = useState(() => {
    const existing = sessionSecurityStore.getSecuredActiveMeeting();
    if (existing && existing.userId) return existing.userId;
    const stored = typeof window !== 'undefined' ? sessionStorage.getItem('infinitymeet_user_id') : null;
    if (stored) return stored;
    const newId = 'usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    if (typeof window !== 'undefined') {
      try { sessionStorage.setItem('infinitymeet_user_id', newId); } catch (e) {}
    }
    return newId;
  });
  const [mirrorVideo, setMirrorVideo] = useState(true);

  const [upcomingSessions, setUpcomingSessions] = useState<MajlisSession[]>(DEFAULT_UPCOMING_SESSIONS);
  const [isStartModalOpen, setIsStartModalOpen] = useState(false);
  const [startModalMode, setStartModalMode] = useState<'start' | 'schedule'>('start');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Active Live Meeting State — restores seamlessly from dedicated secured session on refresh
  const [activeMeeting, setActiveMeeting] = useState<{
    roomId: string;
    title: string;
    userName: string;
    isHost: boolean;
    stream: MediaStream | null;
    isMuted: boolean;
    isVideoOff: boolean;
  } | null>(() => {
    const secured = sessionSecurityStore.getSecuredActiveMeeting();
    const info = getRoomInfoFromCurrentLocation();
    // If user refreshed while in a meeting, restore active meeting directly
    if (secured && info && info.roomId && secured.roomId.toLowerCase() === info.roomId.toLowerCase()) {
      return {
        roomId: secured.roomId,
        title: secured.title,
        userName: secured.userName,
        isHost: secured.isHost,
        stream: null,
        isMuted: secured.isMuted,
        isVideoOff: secured.isVideoOff,
      };
    }
    return null;
  });

  // Pre-join Target (for first-time joiners or entering via code/link)
  const [preJoinTarget, setPreJoinTarget] = useState<{
    roomId: string;
    title?: string;
    isHost?: boolean;
  } | null>(() => {
    const info = getRoomInfoFromCurrentLocation();
    const secured = sessionSecurityStore.getSecuredActiveMeeting();
    // If already restored into activeMeeting, do not show prejoin
    if (secured && info && info.roomId && secured.roomId.toLowerCase() === info.roomId.toLowerCase()) {
      return null;
    }
    if (info && info.roomId) {
      const localTitle = getRoomTitleLocally(info.roomId);
      return {
        roomId: info.roomId,
        title: info.title || localTitle || `Majlis (${info.roomId})`,
        isHost: false,
      };
    }
    return null;
  });

  const [joinErrorMessage, setJoinErrorMessage] = useState<string | null>(null);

  // Live ongoing majalis fetched and synced via WebSocket & REST
  const { activeMajalis, refreshActiveMajalis, addOptimisticMajlis, removeRoom, clearAllActive, loading } = useActiveMajalis(!!activeMeeting);

  useEffect(() => {
    // Subscribe to Firestore scheduled sessions for real-time schedule sync
    let schedUnsub: (() => void) | null = null;
    try {
      schedUnsub = subscribeToScheduledSessions((sessions) => {
        if (Array.isArray(sessions) && sessions.length > 0) {
          setUpcomingSessions(sessions);
        }
      });
    } catch (e) {
      console.warn('Scheduled sessions subscriber error:', e);
    }

    return () => {
      if (schedUnsub) schedUnsub();
    };
  }, []);

  useEffect(() => {
    fetchAppConfig();

    const handleLocationChange = async () => {
      const info = getRoomInfoFromCurrentLocation();
      if (info && info.roomId && !activeMeeting) {
        const cleanedId = info.roomId.toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (cleanedId.length >= 2) {
          // Look up title and host from active list, local title, or URL
          const existing = activeMajalis.find((m) => m.roomId.toLowerCase() === cleanedId);
          const localTitle = getRoomTitleLocally(cleanedId);
          const resolvedTitle = info.title || existing?.title || localTitle || `Majlis (${cleanedId})`;

          setJoinErrorMessage(null);
          setPreJoinTarget((curr) => {
            if (curr && curr.roomId === cleanedId) return curr;
            return {
              roomId: cleanedId,
              title: resolvedTitle,
              isHost: false,
            };
          });
        }
      }
    };

    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
    };
  }, [activeMeeting, activeMajalis]);

  const handleUpdateUserName = (newName: string) => {
    setUserName(newName);
    localStorage.setItem('infinitymeet_username', newName);
  };

  const handleInitiateJoin = (roomId: string, title?: string) => {
    const existing = activeMajalis.find((m) => m.roomId.toLowerCase() === roomId.toLowerCase());
    const localTitle = getRoomTitleLocally(roomId);
    const resolvedTitle = title || existing?.title || localTitle || `Majlis (${roomId})`;
    setPreJoinTarget({
      roomId,
      title: resolvedTitle,
      isHost: false,
    });
  };

  const handleEnterLiveMeeting = (params: {
    roomId: string;
    userName: string;
    isHost: boolean;
    stream: MediaStream | null;
    isMuted: boolean;
    isVideoOff: boolean;
    title?: string;
  }) => {
    const title = params.title || preJoinTarget?.title || 'Live Majlis';
    const chosenName = params.userName.trim() || (user?.email?.split('@')[0]) || userName;

    setUserName(chosenName);
    localStorage.setItem('infinitymeet_username', chosenName);
    setPreJoinTarget(null);

    // Only grant moderator/host privileges if signed in using an authorized moderator account
    const effectiveIsHost = Boolean(isModerator && params.isHost);

    // Secure the live session and all its details in dedicated store
    sessionSecurityStore.saveSecuredMeeting({
      roomId: params.roomId,
      title,
      userName: chosenName,
      userId,
      isHost: effectiveIsHost,
      isMuted: params.isMuted,
      isVideoOff: params.isVideoOff,
      participantCount: 1,
    });

    setActiveMeeting({
      roomId: params.roomId,
      title,
      userName: chosenName,
      isHost: effectiveIsHost,
      stream: params.stream,
      isMuted: params.isMuted,
      isVideoOff: params.isVideoOff,
    });

    const newUrl = `${window.location.pathname}?room=${params.roomId}&title=${encodeURIComponent(title)}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
  };

  const handleEndOrLeaveMeeting = (endedRoomId?: string) => {
    const targetRoomId = endedRoomId || activeMeeting?.roomId;
    if (activeMeeting?.stream) {
      activeMeeting.stream.getTracks().forEach((track) => track.stop());
    }
    if (targetRoomId) {
      sessionSecurityStore.endSecuredMeeting(targetRoomId);
      removeRoom(targetRoomId);
      endCloudRoomSession(targetRoomId).catch(() => {});
      fetch(getBackendApiUrl('/api/end-majlis'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: targetRoomId }),
      }).catch(() => {});
    }
    setActiveMeeting(null);
    window.history.pushState({}, '', window.location.pathname);
  };

  const handleStartNewSession = (newSession: MajlisSession) => {
    setIsStartModalOpen(false);

    // Save locally for Vercel / multi-tab sessions
    saveRoomTitleLocally(newSession.roomId, newSession.title);

    // Secure in dedicated session security store
    sessionSecurityStore.saveSecuredMeeting({
      roomId: newSession.roomId,
      title: newSession.title,
      userName: newSession.hostName,
      userId,
      isHost: true,
      participantCount: 1,
    });

    // Optimistically add to active list
    addOptimisticMajlis(newSession);

    // Register on cloud Firestore
    createCloudRoom({
      roomId: newSession.roomId,
      title: newSession.title,
      hostName: newSession.hostName,
    }).catch(console.warn);

    // Register on server
    fetch(getBackendApiUrl('/api/create-majlis'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: newSession.roomId,
        title: newSession.title,
        hostName: newSession.hostName,
      }),
    }).catch(console.warn);

    // Transition host directly into pre-join screen with host flag enabled
    setPreJoinTarget({
      roomId: newSession.roomId,
      title: newSession.title,
      isHost: true,
    });
  };

  // 1. ACTIVE LIVE MEETING VIEW
  if (activeMeeting) {
    return (
      <MeetingRoom
        roomId={activeMeeting.roomId}
        userId={userId}
        userName={activeMeeting.userName}
        sessionTitle={activeMeeting.title}
        isHost={activeMeeting.isHost}
        initialStream={activeMeeting.stream}
        initialMuted={activeMeeting.isMuted}
        initialVideoOff={activeMeeting.isVideoOff}
        onEndOrLeaveMeeting={handleEndOrLeaveMeeting}
      />
    );
  }

  // 2. PRE-JOIN / PREPARATION SCREEN
  if (preJoinTarget) {
    return (
      <>
        <PreJoinScreen
          roomId={preJoinTarget.roomId}
          sessionTitle={preJoinTarget.title}
          isHostDefault={preJoinTarget.isHost}
          defaultUserName={userName}
          onEnterMeeting={handleEnterLiveMeeting}
          onCancel={() => {
            setPreJoinTarget(null);
            window.history.pushState({}, '', window.location.pathname);
          }}
          onOpenAuthModal={() => setIsAuthModalOpen(true)}
        />
        <AuthModal
          isOpen={isAuthModalOpen}
          onClose={() => setIsAuthModalOpen(false)}
        />
      </>
    );
  }

  // 3. MAIN APPLICATION SHELL
  return (
    <div className="w-full h-screen bg-[#120B07] flex flex-col md:flex-row overflow-hidden font-sans text-[#FFFCF5] antialiased">
      <Sidebar
        currentTab={currentTab}
        onSelectTab={(tab) => setCurrentTab(tab)}
        userName={userName}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
      />

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {currentTab === 'home' && (
          <HomeScreen
            activeMajalis={activeMajalis}
            loadingActiveMajalis={loading}
            upcomingSessions={upcomingSessions}
            onStartMajlis={() => setIsStartModalOpen(true)}
            onJoinMajlis={handleInitiateJoin}
            onClearActive={clearAllActive}
            onRefreshActive={refreshActiveMajalis}
            externalErrorMessage={joinErrorMessage}
            onClearExternalError={() => setJoinErrorMessage(null)}
          />
        )}

        {currentTab === 'majalis' && (
          <MajalisScreen
            activeMajalis={activeMajalis}
            loadingActiveMajalis={loading}
            upcomingSessions={upcomingSessions}
            onJoinMajlis={handleInitiateJoin}
            onStartMajlis={() => {
              setStartModalMode('start');
              setIsStartModalOpen(true);
            }}
            onScheduleMajlis={() => {
              setStartModalMode('schedule');
              setIsStartModalOpen(true);
            }}
            onClearActive={clearAllActive}
            onRefreshActive={refreshActiveMajalis}
          />
        )}

        {currentTab === 'profile' && (
          <ProfileScreen
            userName={userName}
            onUpdateUserName={handleUpdateUserName}
          />
        )}

        {currentTab === 'settings' && (
          <SettingsView
            userName={userName}
            onUpdateUserName={handleUpdateUserName}
            mirrorVideo={mirrorVideo}
            onToggleMirror={setMirrorVideo}
          />
        )}
      </main>

      {isStartModalOpen && (
        <StartMajlisModal
          userName={userName}
          onClose={() => setIsStartModalOpen(false)}
          onStartSession={handleStartNewSession}
          onOpenAuthModal={() => setIsAuthModalOpen(true)}
          initialMode={startModalMode}
        />
      )}

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainAppContent />
    </AuthProvider>
  );
}
