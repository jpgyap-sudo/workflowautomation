'use client';

import { Download, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export default function PWAInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('qas-install-dismissed') === '1';
  });
  const [isStandalone] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in window.navigator && Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone));
  });

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  }, []);

  const isIOS = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }, []);

  if (isStandalone || dismissed || (!installEvent && !isIOS)) return null;

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === 'accepted') {
      setDismissed(true);
      localStorage.setItem('qas-install-dismissed', '1');
    }
    setInstallEvent(null);
  }

  function dismiss() {
    setDismissed(true);
    localStorage.setItem('qas-install-dismissed', '1');
  }

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl sm:left-auto sm:right-4 sm:w-96">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-[#e8f4fd] p-2 text-[#2490ef]">
          <Download className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">Download this dashboard</p>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            {isIOS && !installEvent
              ? 'On iPhone/iPad, tap Share, then Add to Home Screen to install it like an app.'
              : 'Install it on your phone for a full-screen app experience.'}
          </p>
        </div>
        <button type="button" onClick={dismiss} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100" aria-label="Dismiss install prompt">
          <X className="h-5 w-5" />
        </button>
      </div>
      {installEvent && (
        <button
          type="button"
          onClick={install}
          className="mt-3 min-h-11 w-full rounded-xl bg-[#2490ef] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f7fd1]"
        >
          Install app
        </button>
      )}
    </div>
  );
}
