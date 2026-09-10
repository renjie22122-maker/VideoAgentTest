'use client';
import {
  isProjectResult,
  languageNotice,
  projectNotices,
  requestAttention,
} from './notification-events.ts';
import type { NoticeTarget, StudioNotice } from './notification-events.ts';
import type { Project } from './types.ts';
export const NOTICE_EVENT = 'frame-studio-notice',
  NOTICE_OPEN = 'frame-studio-notice-open',
  NOTICE_SETTINGS = 'frame-studio-notice-settings';
const preferenceKey = 'frame-notifications-v1',
  seenKey = 'frame-notification-seen-v1';
export type NoticePreferences = {
  enabled: boolean;
  language: boolean;
  image: boolean;
  video: boolean;
};
export const defaultNoticePreferences: NoticePreferences = {
  enabled: false,
  language: true,
  image: true,
  video: true,
};
let sessionPreferences: NoticePreferences | undefined;
const snapshots = new Map<string, Project>(),
  memorySeen = new Set<string>(),
  pageSeen = new Set<string>();
export function notificationSupport() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'Notification' in window
  );
}
export function notificationPreferences(): NoticePreferences {
  if (typeof window === 'undefined') return { ...defaultNoticePreferences };
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) ?? '{}');
    return Object.fromEntries(
      Object.entries(defaultNoticePreferences).map(([key, fallback]) => [
        key,
        typeof value?.[key] === 'boolean' ? value[key] : fallback,
      ]),
    ) as NoticePreferences;
  } catch {
    return { ...(sessionPreferences ?? defaultNoticePreferences) };
  }
}
export function saveNotificationPreferences(value: NoticePreferences) {
  sessionPreferences = value;
  try {
    localStorage.setItem(preferenceKey, JSON.stringify(value));
  } catch {
    /* Session UI still works when storage is unavailable. */
  }
  window.dispatchEvent(new CustomEvent(NOTICE_SETTINGS));
}
export function openNotice(target?: NoticeTarget) {
  window.focus();
  if (target)
    window.dispatchEvent(new CustomEvent(NOTICE_OPEN, { detail: target }));
}
function claim(id: string) {
  if (memorySeen.has(id)) return false;
  try {
    const raw = JSON.parse(localStorage.getItem(seenKey) ?? '[]');
    const seen = Array.isArray(raw)
      ? raw.filter(
          (v): v is [string, number] =>
            Array.isArray(v) &&
            typeof v[0] === 'string' &&
            typeof v[1] === 'number' &&
            Date.now() - v[1] < 7 * 86400000,
        )
      : [];
    if (seen.some((v) => v[0] === id)) {
      memorySeen.add(id);
      return false;
    }
    localStorage.setItem(
      seenKey,
      JSON.stringify([...seen, [id, Date.now()]].slice(-300)),
    );
  } catch {
    /* In-memory deduplication remains available. */
  }
  memorySeen.add(id);
  if (memorySeen.size > 500)
    memorySeen.delete(memorySeen.values().next().value!);
  return true;
}
export function displayDesktopNotice(notice: StudioNotice) {
  if (!notificationSupport() || Notification.permission !== 'granted')
    return false;
  try {
    const notification = new Notification('FRAME · ' + notice.title, {
      body: notice.body.slice(0, 240),
      tag: notice.id,
      lang: 'zh-CN',
    });
    notification.onclick = () => {
      openNotice(notice.target);
      notification.close();
    };
    notification.onerror = () =>
      window.dispatchEvent(
        new CustomEvent(NOTICE_SETTINGS, {
          detail: '系统通知未能显示；请检查浏览器和 Windows 通知设置。',
        }),
      );
    return true;
  } catch {
    return false;
  }
}
async function publish(notice: StudioNotice) {
  try {
    // Compact storage keys and OS tags contain no raw errors, prompts, or provider URLs.
    const bytes = new TextEncoder().encode(notice.id);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    notice = {
      ...notice,
      id:
        'frame-' +
        Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join(''),
    };
    if (pageSeen.has(notice.id)) return;
    pageSeen.add(notice.id);
    if (pageSeen.size > 500) pageSeen.delete(pageSeen.values().next().value!);
    window.dispatchEvent(
      new CustomEvent<StudioNotice>(NOTICE_EVENT, { detail: notice }),
    );
    const send = () => {
      const preferences = notificationPreferences();
      if (
        !preferences.enabled ||
        !preferences[notice.category] ||
        !claim(notice.id)
      )
        return;
      if (!displayDesktopNotice(notice))
        window.dispatchEvent(
          new CustomEvent(NOTICE_SETTINGS, {
            detail: '系统通知未能显示；结果仍保留在页面提醒中。',
          }),
        );
    };
    if (navigator.locks)
      await navigator.locks.request('frame-notifications', send);
    else send();
  } catch {
    /* A notification must never make a completed model operation fail. */
  }
}
/** Transport observer covers both ordinary actions and background media polling. */
export function recordStudioResult(action: string, value: unknown) {
  if (typeof window === 'undefined' || !isProjectResult(value)) return;
  try {
    const previous = snapshots.get(value.id);
    if (previous && previous.updatedAt > value.updatedAt) return;
    snapshots.set(value.id, value);
    if (snapshots.size > 20) snapshots.delete(snapshots.keys().next().value!);
    const notices = [
      'asset_abandon',
      'cancel',
      'auto_stop',
      'asset_upload',
      'shot_image_upload',
      'video_tail_upload',
    ].includes(action)
      ? []
      : projectNotices(previous, value);
    const language = languageNotice(action, value);
    if (language) notices.push(language);
    for (const notice of notices) void publish(notice);
  } catch {
    /* Notifications do not change task results. */
  }
}
export function recordStudioFailure(
  action: string,
  data: Record<string, unknown>,
  message: string,
) {
  if (typeof window === 'undefined') return;
  try {
    const previous =
      typeof data.id === 'string' ? snapshots.get(data.id) : undefined;
    const notice = requestAttention(action, data, previous, message);
    if (notice) void publish(notice);
  } catch {
    /* Preserve the original error. */
  }
}
