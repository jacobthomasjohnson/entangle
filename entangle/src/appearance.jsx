import { Lightbulb, ToggleRight, CircleDot, Gauge, Zap, List, Layers, MousePointerClick, Lock, PanelTop, Thermometer, Tv, Camera, User, MapPin, Hash, ListFilter, Download, Cpu, Map, DoorOpen, AppWindow, Footprints, Droplets, Users, Battery, Plug, Sun, Activity } from 'lucide-react';
import { domainOf } from './graph-ui.js';
const categories = {
  light: [Lightbulb, 'var(--color-cbb477, #cbb477)'], switch: [ToggleRight, 'var(--color-85aad2, #85aad2)'], binary_sensor: [CircleDot, 'var(--color-8cba9a, #8cba9a)'], sensor: [Gauge, 'var(--color-b19acd, #b19acd)'], automation: [Zap, 'var(--color-cd9e76, #cd9e76)'], script: [List, 'var(--color-c69cb6, #c69cb6)'], scene: [Layers, 'var(--color-bc9bbb, #bc9bbb)'], button: [MousePointerClick, 'var(--color-96afd0, #96afd0)'], lock: [Lock, 'var(--color-c3ab85, #c3ab85)'], cover: [PanelTop, 'var(--color-95b6bb, #95b6bb)'], climate: [Thermometer, 'var(--color-c5a08a, #c5a08a)'], media_player: [Tv, 'var(--color-9ca8cf, #9ca8cf)'], camera: [Camera, 'var(--color-9db5b0, #9db5b0)'], person: [User, 'var(--color-c3a9bb, #c3a9bb)'], device_tracker: [MapPin, 'var(--color-9cb9ad, #9cb9ad)'], number: [Hash, 'var(--color-a7acc8, #a7acc8)'], select: [ListFilter, 'var(--color-a3b4c7, #a3b4c7)'], update: [Download, 'var(--color-b4b993, #b4b993)'], device: [Cpu, 'var(--color-98a6b9, #98a6b9)'], area: [Map, 'var(--color-81b7b2, #81b7b2)'], entity: [CircleDot, 'var(--color-a6a9b8, #a6a9b8)'],
};
const classes = { binary_sensor: { door: DoorOpen, window: AppWindow, motion: Footprints, moisture: Droplets, occupancy: Users }, sensor: { temperature: Thermometer, humidity: Droplets, battery: Battery, power: Zap, voltage: Plug, illuminance: Sun } };
export function appearance(node) {
  const domain = domainOf(node), [base, color] = categories[domain] || [Activity, 'var(--color-a6a9b8, #a6a9b8)'];
  return { domain, label: domain.replaceAll('_', ' '), Icon: classes[domain]?.[node.deviceClass] || base, color };
}
export function NodeIcon({ node, size = 18 }) { const { Icon, color } = appearance(node); return <Icon size={size} color={color} strokeWidth={1.7} aria-hidden="true"/>; }
