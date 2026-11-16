-- Одно устройство — одна активная сессия. При обновлении клиента имя устройства
-- меняется (3.8.5 → 3.8.6), но device_key_hash остаётся тем же.
DELETE FROM sessions
WHERE device_key_hash <> ''
  AND id NOT IN (
    SELECT MAX(id) FROM sessions
    WHERE device_key_hash <> ''
    GROUP BY user_id, device_key_hash
  );
