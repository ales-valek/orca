import React from 'react'

// Why: Live Ports otherwise shows every Node server as the same generic glyph.
// Each matcher id gets its own colored tile so Storybook, Nest, and Vite read
// apart at 13px without a brand-icon package.
const DEV_SERVER_MARKS: Record<string, { letters: string; color: string; ink?: string }> = {
  next: { letters: 'N', color: '#EDEDED', ink: '#111111' },
  nuxt: { letters: 'Nu', color: '#00DC82', ink: '#00331F' },
  astro: { letters: 'A', color: '#FF5D01' },
  remix: { letters: 'R', color: '#EDEDED', ink: '#111111' },
  sveltekit: { letters: 'S', color: '#FF3E00' },
  gatsby: { letters: 'G', color: '#663399' },
  docusaurus: { letters: 'D', color: '#3ECC5F', ink: '#052E16' },
  angular: { letters: 'A', color: '#DD0031' },
  'react-scripts': { letters: 'R', color: '#087EA4' },
  storybook: { letters: 'SB', color: '#FF4785' },
  nest: { letters: 'N', color: '#E0234E' },
  expo: { letters: 'E', color: '#4630EB' },
  metro: { letters: 'M', color: '#F39C12', ink: '#1F1300' },
  webpack: { letters: 'W', color: '#8DD6F9', ink: '#0B2533' },
  parcel: { letters: 'P', color: '#E7A93C', ink: '#1F1300' },
  'electron-vite': { letters: 'EV', color: '#646CFF' },
  vite: { letters: 'V', color: '#646CFF' },
  rails: { letters: 'R', color: '#CC0000' },
  puma: { letters: 'P', color: '#5B3A29' },
  django: { letters: 'D', color: '#092E20' },
  uvicorn: { letters: 'U', color: '#209070' },
  gunicorn: { letters: 'G', color: '#499848' },
  flask: { letters: 'F', color: '#EDEDED', ink: '#111111' },
  laravel: { letters: 'L', color: '#FF2D20' },
  phoenix: { letters: 'P', color: '#FD4F00' },
  air: { letters: 'A', color: '#1F6FEB' },
  hugo: { letters: 'H', color: '#FF4088' },
  jekyll: { letters: 'J', color: '#CC0000' },
  'json-server': { letters: 'JS', color: '#4B5563' },
  'http-server': { letters: 'H', color: '#4B5563' }
}

export function DevServerIcon({
  id,
  size = 13
}: {
  id: string
  size?: number
}): React.JSX.Element | null {
  const mark = DEV_SERVER_MARKS[id]
  if (!mark) {
    return null
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <rect width="16" height="16" rx="3" fill={mark.color} />
      <text
        x="8"
        y="11.2"
        textAnchor="middle"
        fontSize={mark.letters.length > 1 ? 6.5 : 9}
        fontWeight="700"
        fill={mark.ink ?? '#ffffff'}
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {mark.letters}
      </text>
    </svg>
  )
}
