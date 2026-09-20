import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export function IconGear(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="2.4" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.2 1.2M11.4 11.4l1.2 1.2M12.6 3.4l-1.2 1.2M4.6 11.4l-1.2 1.2" />
    </Icon>
  )
}

export function IconMinus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 8h9" />
    </Icon>
  )
}

export function IconClose(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Icon>
  )
}

export function IconCopy(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
    </Icon>
  )
}

export function IconRefresh(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13 8a5 5 0 1 1-1.6-3.7" />
      <path d="M13 2.5V5h-2.5" />
    </Icon>
  )
}

export function IconSearch(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3 3" />
    </Icon>
  )
}

export function IconPin(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 2h4l-.7 3.2 2.2 2.3H4.5l2.2-2.3z" />
      <path d="M8 7.5V14" />
    </Icon>
  )
}

export function IconChevronDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6.5L8 10.5l4-4" />
    </Icon>
  )
}

export function IconChevronUp(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 9.5L8 5.5l4 4" />
    </Icon>
  )
}

export function IconAlert(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2.5l5.5 10h-11z" />
      <path d="M8 6.5v3M8 11.5v.01" />
    </Icon>
  )
}

export function IconFolder(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 4.5A1 1 0 0 1 3.5 3.5h2.6l1.2 1.5h5.2a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
    </Icon>
  )
}

export function IconExternal(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 3.5h3.5V7" />
      <path d="M12.5 3.5L7.5 8.5" />
      <path d="M11 9.5v2a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h2" />
    </Icon>
  )
}
