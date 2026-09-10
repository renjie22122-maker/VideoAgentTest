'use client';
import { useEffect, useState } from 'react';
import { Bell, BellRing } from 'lucide-react';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
} from './ui/popover';
import { Toaster, toast } from './ui/toast';
import {
  NOTICE_EVENT,
  NOTICE_OPEN,
  NOTICE_SETTINGS,
  notificationSupport,
  notificationPreferences,
  saveNotificationPreferences,
  defaultNoticePreferences,
  displayDesktopNotice,
  openNotice,
} from '@/lib/studio/notification-client';
import type { NoticePreferences } from '@/lib/studio/notification-client';
import type {
  NoticeTarget,
  StudioNotice,
} from '@/lib/studio/notification-events';
export function NotificationCenter({
  onOpen,
}: {
  onOpen: (target: NoticeTarget) => void;
}) {
  const [preferences, setPreferences] = useState<NoticePreferences>(
    defaultNoticePreferences,
  );
  const [permission, setPermission] = useState<
    NotificationPermission | 'unsupported'
  >('default');
  const [message, setMessage] = useState(''),
    [requesting, setRequesting] = useState(false),
    [recent, setRecent] = useState<StudioNotice[]>([]);
  useEffect(() => {
    const refresh = () => {
      setPreferences(notificationPreferences());
      setPermission(
        notificationSupport() ? Notification.permission : 'unsupported',
      );
    };
    refresh();
    const settings = (event: Event) => {
      refresh();
      if (typeof (event as CustomEvent).detail === 'string')
        setMessage((event as CustomEvent<string>).detail);
    };
    const receive = (event: Event) => {
      const notice = (event as CustomEvent<StudioNotice>).detail;
      setRecent((items) =>
        [notice, ...items.filter((n) => n.id !== notice.id)].slice(0, 10),
      );
      toast.add({
        id: notice.id,
        title: notice.title,
        description: notice.body,
        type: notice.outcome === 'attention' ? 'warning' : 'success',
        timeout: 10000,
        actionProps: notice.target
          ? { children: '查看', onClick: () => openNotice(notice.target) }
          : undefined,
      });
    };
    window.addEventListener(NOTICE_EVENT, receive);
    window.addEventListener(NOTICE_SETTINGS, settings);
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener(NOTICE_EVENT, receive);
      window.removeEventListener(NOTICE_SETTINGS, settings);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  useEffect(() => {
    const open = (event: Event) =>
      onOpen((event as CustomEvent<NoticeTarget>).detail);
    window.addEventListener(NOTICE_OPEN, open);
    return () => window.removeEventListener(NOTICE_OPEN, open);
  }, [onOpen]);
  function update(next: NoticePreferences) {
    setPreferences(next);
    saveNotificationPreferences(next);
  }
  async function enable() {
    if (!notificationSupport()) {
      setPermission('unsupported');
      return;
    }
    setRequesting(true);
    setMessage('');
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        update({ ...preferences, enabled: true });
        setMessage('已开启。可以点击“发送测试通知”检查右下角提醒。');
      } else {
        update({ ...preferences, enabled: false });
        setMessage(
          result === 'denied'
            ? '通知权限被阻止，请在浏览器的网站权限中允许通知后重试。'
            : '尚未允许通知；页面内仍会提示结果。',
        );
      }
    } catch {
      setMessage(
        '当前浏览器无法开启系统提醒，可改用 Edge 或 Chrome 打开工作台。',
      );
    } finally {
      setRequesting(false);
    }
  }
  function test() {
    const sent = displayDesktopNotice({
      id: 'frame-test-' + Date.now(),
      title: '完成提醒测试',
      body: '这是测试通知；今后模型结果返回时会在这里提醒你。没有调用任何模型。',
      category: 'language',
      outcome: 'ready',
      at: Date.now(),
    });
    setMessage(
      sent
        ? '已请求发送测试通知。如果右下角没有横幅，请检查 Windows 通知中心、勿扰模式和浏览器通知设置。'
        : '无法发送，请先允许通知，或使用 Edge / Chrome。',
    );
  }
  const enabled = preferences.enabled && permission === 'granted';
  return (
    <>
      <Toaster limit={3} />
      <Popover>
        <PopoverTrigger render={<Button variant="outline" />}>
          {enabled ? <BellRing size={16} /> : <Bell size={16} />}完成提醒
          {enabled ? ' · 已开启' : ''}
        </PopoverTrigger>
        <PopoverContent align="end" className="notification-panel">
          <PopoverTitle>模型结果返回时提醒我</PopoverTitle>
          <PopoverDescription>
            页面内始终提示；开启后也发送 Windows 桌面通知。
          </PopoverDescription>
          <div className="queue-actions">
            {enabled ? (
              <Button
                variant="outline"
                onClick={() => {
                  update({ ...preferences, enabled: false });
                  setMessage('已关闭桌面通知，页面提醒保留。');
                }}
              >
                关闭桌面通知
              </Button>
            ) : (
              <Button
                disabled={requesting || permission === 'unsupported'}
                onClick={() => void enable()}
              >
                {requesting ? '等待允许…' : '开启桌面通知'}
              </Button>
            )}
            <Button variant="outline" disabled={!enabled} onClick={test}>
              发送测试通知
            </Button>
          </div>
          {permission === 'unsupported' && (
            <p>
              当前内置浏览器不支持系统通知。可在 Edge / Chrome 中打开{' '}
              <a href="http://localhost:3000/" target="_blank" rel="noreferrer">
                本地工作台
              </a>{' '}
              后开启。
            </p>
          )}
          {permission === 'denied' && (
            <p>通知已被浏览器阻止；请在地址栏的网站权限中改为允许通知。</p>
          )}
          <div className="notification-choices">
            {(
              [
                ['language', '语言模型 / Agent'],
                ['image', '美术图 / 分镜画面'],
                ['video', '视频片段'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <span>{label}</span>
                <Switch
                  checked={preferences[key]}
                  onCheckedChange={(checked) =>
                    update({ ...preferences, [key]: checked })
                  }
                  aria-label={label + '桌面提醒'}
                />
              </label>
            ))}
          </div>
          <p className="help">
            保持工作台标签页打开，可以切换页面或最小化。关闭标签页、休眠或浏览器冻结后，不能保证及时收到提醒。桌面通知包含作品和任务名称，点击可返回查看。
          </p>
          {message && <output aria-live="polite">{message}</output>}
          {recent.length > 0 && (
            <section className="notification-history">
              <h3>本次打开后的提醒</h3>
              {recent.map((n) => (
                <div key={n.id}>
                  <strong>{n.title}</strong>
                  <p>{n.body}</p>
                  {n.target && (
                    <Button
                      variant="ghost"
                      onClick={() => openNotice(n.target)}
                    >
                      查看结果
                    </Button>
                  )}
                </div>
              ))}
            </section>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}
