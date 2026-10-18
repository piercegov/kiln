import { defineConfig } from 'vitepress'
import llmstxt from 'vitepress-plugin-llms'
import apiSidebar from '../api/typedoc-sidebar.json' with { type: 'json' }

export default defineConfig({
  title: 'Kiln',
  description: 'An agent-first ECS game runtime on Three.js and Koota.',
  cleanUrls: true,
  lastUpdated: false,
  srcExclude: ['README.md'],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/introduction', activeMatch: '/guide/' },
      { text: 'Concepts', link: '/concepts/ecs', activeMatch: '/concepts/' },
      { text: 'Plugins', link: '/plugins/', activeMatch: '/plugins/' },
      { text: 'Testing', link: '/testing/scenarios', activeMatch: '/testing/' },
      { text: 'Reference', link: '/reference/cli', activeMatch: '/reference/' },
      { text: 'API', link: '/api/', activeMatch: '/api/' },
    ],
    sidebar: {
      '/api/': [{ text: 'API reference', link: '/api/', items: apiSidebar }],
      '/': [
        {
          text: 'Guide',
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'Getting started', link: '/guide/getting-started' },
            { text: 'Project layout', link: '/guide/project-layout' },
            { text: 'Working with agents', link: '/guide/agents' },
            { text: 'A complete feature', link: '/guide/first-feature' },
          ],
        },
        {
          text: 'Concepts',
          items: [
            { text: 'Entities and traits', link: '/concepts/ecs' },
            { text: 'Systems', link: '/concepts/systems' },
            { text: 'The schedule', link: '/concepts/schedule' },
            { text: 'Resources and events', link: '/concepts/resources-events' },
            { text: 'Prefabs and plugins', link: '/concepts/prefabs-plugins' },
            { text: 'States', link: '/concepts/states' },
            { text: 'Determinism', link: '/concepts/determinism' },
            { text: 'Hot reload', link: '/concepts/hot-reload' },
          ],
        },
        {
          text: 'Plugins',
          items: [
            { text: 'Overview', link: '/plugins/' },
            { text: 'Rendering', link: '/plugins/render' },
            { text: 'Input', link: '/plugins/input' },
            { text: 'Assets', link: '/plugins/assets' },
            { text: 'Timers and tweens', link: '/plugins/timers-tweens' },
            { text: 'HUD and UI', link: '/plugins/ui' },
            { text: 'Camera', link: '/plugins/camera' },
            { text: 'Saving', link: '/plugins/save' },
            { text: 'Animation', link: '/plugins/animation' },
            { text: 'Physics', link: '/plugins/physics' },
            { text: 'Debug panel', link: '/plugins/debug' },
            { text: 'Shaders (TSL)', link: '/plugins/tsl' },
            { text: 'Community plugins', link: '/plugins/community' },
          ],
        },
        {
          text: 'Testing',
          items: [
            { text: 'Scenario tests', link: '/testing/scenarios' },
            { text: 'Recordings and replay', link: '/testing/recordings' },
            { text: 'Snapshots', link: '/testing/snapshots' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'CLI', link: '/reference/cli' },
            { text: 'Configuration', link: '/reference/config' },
            { text: 'Errors', link: '/reference/errors' },
            { text: 'Design notes', link: '/design' },
            { text: 'API', link: '/api/' },
          ],
        },
      ],
    },
    outline: [2, 3],
    search: { provider: 'local' },
  },
  vite: {
    plugins: [
      // llms.txt and llms-full.txt: the guides in one fetch for agents. The API pages stay per-page.
      llmstxt({ ignoreFilesPerOutput: { llmsTxt: ['api/**'], llmsFullTxt: ['api/**'] } }),
    ],
  },
})
