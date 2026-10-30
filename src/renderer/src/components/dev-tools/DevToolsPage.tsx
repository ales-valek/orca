import { translate } from '@/i18n/i18n'
import React from 'react'

/** Tools page: tool cards above, tool browser tabs below. */
export default function DevToolsPage(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
      <h1 className="px-4 py-3 text-[15px] font-semibold">
        {translate('devTools.title', 'Tools')}
      </h1>
    </div>
  )
}
