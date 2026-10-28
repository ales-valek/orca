// The @hcengineering packages publish no type declarations; declare only the surface Orca uses.
declare module '@hcengineering/api-client' {
  export type HulyFindOptions = { sort?: Record<string, 1 | -1>; limit?: number }

  export type PlatformClient = {
    findAll(
      _class: string,
      query: Record<string, unknown>,
      options?: HulyFindOptions
    ): Promise<unknown[]>
    findOne(
      _class: string,
      query: Record<string, unknown>,
      options?: HulyFindOptions
    ): Promise<unknown>
    updateDoc(
      _class: string,
      space: string,
      objectId: string,
      operations: Record<string, unknown>
    ): Promise<unknown>
    fetchMarkup(
      objectClass: string,
      objectId: string,
      objectAttr: string,
      markup: string,
      format: 'markup' | 'html' | 'markdown'
    ): Promise<string>
    close(): Promise<void>
  }

  export function connect(
    url: string,
    options: { token: string; workspace: string; connectionTimeout?: number }
  ): Promise<PlatformClient>
}

declare module '@hcengineering/text-core' {
  export type MarkupNode = { type: string }
  export function markupToJSON(markup: string): MarkupNode
}

declare module '@hcengineering/text-markdown' {
  import type { MarkupNode } from '@hcengineering/text-core'

  export function markupToMarkdown(
    markup: MarkupNode,
    options?: { refUrl?: string; imageUrl?: string }
  ): string
}
