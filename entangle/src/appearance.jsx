import { Lightbulb, ToggleRight, CircleDot, Gauge, Zap, List, Layers, MousePointerClick, Lock, PanelTop, Thermometer, Tv, Camera, User, MapPin, Hash, ListFilter, Download, Cpu, Map, DoorOpen, AppWindow, Footprints, Droplets, Users, Battery, Plug, Sun, Activity } from 'lucide-react';
import { domainOf } from './graph-ui.js';
const categories = {
  light: [Lightbulb, '#cbb477'], switch: [ToggleRight, '#85aad2'], binary_sensor: [CircleDot, '#8cba9a'], sensor: [Gauge, '#b19acd'], automation: [Zap, '#cd9e76'], script: [List, '#c69cb6'], scene: [Layers, '#bc9bbb'], button: [MousePointerClick, '#96afd0'], lock: [Lock, '#c3ab85'], cover: [PanelTop, '#95b6bb'], climate: [Thermometer, '#c5a08a'], media_player: [Tv, '#9ca8cf'], camera: [Camera, '#9db5b0'], person: [User, '#c3a9bb'], device_tracker: [MapPin, '#9cb9ad'], number: [Hash, '#a7acc8'], select: [ListFilter, '#a3b4c7'], update: [Download, '#b4b993'], device: [Cpu, '#98a6b9'], area: [Map, '#81b7b2'], entity: [CircleDot, '#a6a9b8'],
};
const classes = { binary_sensor: { door: DoorOpen, window: AppWindow, motion: Footprints, moisture: Droplets, occupancy: Users }, sensor: { temperature: Thermometer, humidity: Droplets, battery: Battery, power: Zap, voltage: Plug, illuminance: Sun } };
export function appearance(node) {
  const domain = domainOf(node), [base, color] = categories[domain] || [Activity, '#a6a9b8'];
  return { domain, label: domain.replaceAll('_', ' '), Icon: classes[domain]?.[node.deviceClass] || base, color };
}
export function NodeIcon({ node, size = 18 }) { const { Icon, color } = appearance(node); return <Icon size={size} color={color} strokeWidth={1.7} aria-hidden="true"/>; }
