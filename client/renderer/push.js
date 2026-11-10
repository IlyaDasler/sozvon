// FCM только в нативной оболочке. В PWA/Electron этот файл молчит.
(() => {
  const cap = window.Capacitor;
  if (!cap?.isNativePlatform?.()) return;
  const Push = cap.Plugins?.PushNotifications;
  if (!Push) return;

  let token = '';
  let saved = '';
  const save = async () => {
    if (!token || !Api.token || saved === token) return;
    try {
      await Api.post('/push/register', { token, platform: 'android' });
      saved = token;
    } catch {}
  };

  Push.addListener('registration', (value) => {
    token = value.value || '';
    save();
  });
  Push.addListener('registrationError', () => {});
  Push.addListener('pushNotificationActionPerformed', (event) => {
    const data = event?.notification?.data || {};
    if (data.roomId && typeof openRoomChat === 'function') openRoomChat(Number(data.roomId));
    else if (data.contactId && typeof selectContact === 'function') selectContact(Number(data.contactId));
  });

  Push.requestPermissions()
    .then((status) => {
      if (status.receive === 'granted') return Push.register();
    })
    .catch(() => {});

  setInterval(save, 4000);
})();
