import { VideoAirPlayButton } from 'expo-video';

/** iPhone / iPad / Mac app: the system AirPlay picker (Samsung, LG, Sony, Apple TV...). */
export default function AirPlayNative() {
  return <VideoAirPlayButton style={{ width: 44, height: 44 }} tint="#F4F5F7" activeTint="#F2C14E" prioritizeVideoDevices />;
}
