import {
  BedDoubleIcon,
  BookOpenIcon,
  BrainIcon,
  BriefcaseIcon,
  CheckSquareIcon,
  DumbbellIcon,
  FootprintsIcon,
  GuitarIcon,
  HeartPulseIcon,
  MoonStarIcon,
  SmartphoneIcon,
  UtensilsIcon,
} from "lucide-react"

export const TYPE_ICONS = {
  workout: DumbbellIcon,
  reading: BookOpenIcon,
  work: BriefcaseIcon,
  food: UtensilsIcon,
  guitar: GuitarIcon,
  meditation: BrainIcon,
  dream: MoonStarIcon,
  screentime: SmartphoneIcon,
  steps: FootprintsIcon,
  cardio: HeartPulseIcon,
  habit: CheckSquareIcon,
  sleep: BedDoubleIcon,
}

export function TypeIcon({ type, ...props }) {
  const Icon = TYPE_ICONS[type] || CheckSquareIcon
  return <Icon aria-hidden="true" {...props} />
}
