import { useTVEventHandler } from 'react-native';

/** TV remote events (Fire TV, Android TV). eventType: up, down, left, right, select, playPause... */
export function useRemote(handler: (eventType: string) => void) {
  useTVEventHandler((evt) => {
    if (evt?.eventType) handler(evt.eventType);
  });
}
