/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_UMAMI_SCRIPT_URL?: string
  readonly VITE_UMAMI_WEBSITE_ID?: string
  readonly VITE_AD_SCRIPT_URL?: string
  readonly VITE_AD_CLIENT_ID?: string
  readonly VITE_AD_SLOT_HEADER?: string
  readonly VITE_AD_SLOT_FOOTER?: string
  readonly VITE_AD_SLOT_SIDEBAR?: string
  readonly VITE_AD_SLOT_INCONTENT?: string
  readonly VITE_AD_SLOT_INFEED?: string
  readonly VITE_AD_LAYOUT_KEY_INFEED?: string
  readonly VITE_AD_SLOT_MULTIPLEX?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
