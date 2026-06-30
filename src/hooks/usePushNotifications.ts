import { useState, useEffect, useCallback } from "react";
import { auth } from "@/integrations/firebase/config";
import { API_BASE } from "@/lib/cloud-functions";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

// VAPID Public Key - safe to expose in frontend
const VAPID_PUBLIC_KEY = "BN6FuoIxeoTQuKkBohhBzymnZ-GNyrKS0_zvlMZZcoEoytMVBmr0uNplTQl5yA-KfYLYuKErlnuKLElN81Yyz04";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function callPushSubscribeFunction(token: string, body: any) {
  const response = await fetch(`${API_BASE}/api/push-subscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Error calling push-subscribe function');
  }

  return response.json();
}

interface PushNotificationState {
  isSupported: boolean;
  isEnabled: boolean;
  isLoading: boolean;
  permission: NotificationPermission | 'default';
}

export function usePushNotifications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [state, setState] = useState<PushNotificationState>({
    isSupported: false,
    isEnabled: false,
    isLoading: true,
    permission: 'default'
  });

  const checkSupport = useCallback(() => {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }, []);

  const syncSubscription = useCallback(async (subscription: PushSubscription) => {
    if (!user) return;
    try {
      const p256dhKey = subscription.getKey('p256dh');
      const authKey = subscription.getKey('auth');
      if (!p256dhKey || !authKey) return;

      const p256dhBase64 = btoa(String.fromCharCode(...new Uint8Array(p256dhKey)));
      const authBase64 = btoa(String.fromCharCode(...new Uint8Array(authKey)));

      const token = await user.getIdToken();
      await callPushSubscribeFunction(token, {
        action: 'subscribe',
        subscription: {
          endpoint: subscription.endpoint,
          p256dhKey: p256dhBase64,
          authKey: authBase64,
          deviceInfo: { userAgent: navigator.userAgent, platform: navigator.platform }
        }
      });
    } catch (e) {
      console.error("[Push] Error syncing subscription:", e);
    }
  }, [user]);

  const loadState = useCallback(async () => {
    if (!user) {
      setState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    const isSupported = checkSupport();
    const permission = isSupported ? Notification.permission : 'default';

    let hasActiveSubscription = false;
    if (isSupported && permission === 'granted') {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          hasActiveSubscription = true;
          // Always re-sync to ensure current user owns this subscription
          await syncSubscription(subscription);
        }
      } catch (e) {
        console.error("[Push] Error checking subscription:", e);
      }
    }

    setState({
      isSupported,
      isEnabled: hasActiveSubscription,
      isLoading: false,
      permission
    });
  }, [user, checkSupport, syncSubscription]);

  useEffect(() => {
    loadState();
    const handleVisibility = () => { if (!document.hidden) loadState(); };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [loadState]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!user || !state.isSupported) {
      toast({ title: "No soportado", description: "Tu navegador no soporta notificaciones push", variant: "destructive" });
      return false;
    }

    if (Notification.permission === 'denied') {
      setState(prev => ({ ...prev, permission: 'denied' }));
      toast({ title: "Notificaciones bloqueadas", description: "Desbloquéalas desde el candado de la barra de direcciones y recarga la página.", variant: "destructive" });
      return false;
    }

    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const permission = await Notification.requestPermission();
      setState(prev => ({ ...prev, permission }));

      if (permission !== 'granted') {
        toast({ title: "Permiso denegado", description: "Permite las notificaciones para activarlas", variant: "destructive" });
        setState(prev => ({ ...prev, isLoading: false }));
        return false;
      }

      const registration = await navigator.serviceWorker.ready;
      const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey.buffer as ArrayBuffer
      });

      const p256dhKey = subscription.getKey('p256dh');
      const authKey = subscription.getKey('auth');
      if (!p256dhKey || !authKey) throw new Error("No se pudieron obtener las claves de suscripción");

      const p256dhBase64 = btoa(String.fromCharCode(...new Uint8Array(p256dhKey)));
      const authBase64 = btoa(String.fromCharCode(...new Uint8Array(authKey)));

      const token = await user.getIdToken();
      await callPushSubscribeFunction(token, {
        action: 'subscribe',
        subscription: {
          endpoint: subscription.endpoint,
          p256dhKey: p256dhBase64,
          authKey: authBase64,
          deviceInfo: { userAgent: navigator.userAgent, platform: navigator.platform }
        }
      });

      setState(prev => ({ ...prev, isEnabled: true, isLoading: false }));
      toast({ title: "Notificaciones activadas", description: "Recibirás notificaciones cuando tus tareas lleguen a su fecha" });
      return true;
    } catch (error: any) {
      console.error("[Push] Subscription error:", error);
      toast({ title: "Error", description: error.message || "No se pudieron activar las notificaciones", variant: "destructive" });
      setState(prev => ({ ...prev, isLoading: false }));
      return false;
    }
  }, [user, state.isSupported, toast]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!user) return false;
    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const token = await user.getIdToken();
        await callPushSubscribeFunction(token, {
          action: 'unsubscribe',
          endpoint: subscription.endpoint
        });
        await subscription.unsubscribe();
      }

      setState(prev => ({ ...prev, isEnabled: false, isLoading: false }));
      toast({ title: "Notificaciones desactivadas", description: "Ya no recibirás notificaciones push" });
      return true;
    } catch (error: any) {
      console.error("[Push] Unsubscribe error:", error);
      toast({ title: "Error", description: error.message || "No se pudieron desactivar las notificaciones", variant: "destructive" });
      setState(prev => ({ ...prev, isLoading: false }));
      return false;
    }
  }, [user, toast]);

  const toggle = useCallback(async () => {
    return state.isEnabled ? unsubscribe() : subscribe();
  }, [state.isEnabled, subscribe, unsubscribe]);

  return { ...state, subscribe, unsubscribe, toggle, refresh: loadState };
}
