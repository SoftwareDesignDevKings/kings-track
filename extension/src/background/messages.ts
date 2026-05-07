const ext = self.KingsTrackExtension

interface BackgroundActions {
  getState: () => Promise<Record<string, any>>
  setState: (state: Record<string, any>) => Promise<Record<string, any>>
  runVisibleAction: (action: string, callback: () => Promise<any>) => Promise<any>
  syncStudentsApi: () => Promise<any>
  syncClassesApi: () => Promise<any>
  importMappedClasses: () => Promise<any>
  syncSchoolGroupsScrape: () => Promise<any>
  syncReportingClass: () => Promise<any>
}

export function registerMessageHandlers(actions: BackgroundActions) {
  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === 'kings.debug.log') {
      // Telemetry was dropped; content scripts still emit these for the popup log viewer.
      return Promise.resolve(undefined)
    }

    if (message?.type === 'kings.gradeo.progress') {
      return actions.setState({ status: 'scraping_reporting', progress: message.progress })
    }

    if (message?.type === 'kings.popup.getContext') {
      return Promise.all([ext.getConfig(), actions.getState()])
        .then(async ([config, state]) => {
          const base = String(config.frontendUrl || '').trim().replace(/\/$/, '')
          let bridgeTabOpen = false
          if (base) {
            try {
              const tabs = await browser.tabs.query({})
              bridgeTabOpen = (tabs || []).some(tab =>
                typeof tab.url === 'string' && tab.url.startsWith(`${base}/extension-bridge`),
              )
            } catch (_error) {
              bridgeTabOpen = false
            }
          }
          return { config, state, bridgeTabOpen }
        })
    }

    if (message?.type === 'kings.popup.saveConfig') {
      ext.logDebug('popup', 'save_config_clicked', {
        frontendUrl: message.config?.frontendUrl || '',
      })
      return ext.saveConfig(message.config)
    }

    if (message?.type === 'kings.popup.openBridgeTab') {
      return ext.getConfig().then((config) => {
        const base = String(config.frontendUrl || '').trim().replace(/\/$/, '')
        if (!base) {
          throw new Error('Set the Kings Track Dashboard URL in Settings.')
        }
        return browser.tabs.create({ url: `${base}/extension-bridge` })
      })
    }

    if (message?.type === 'kings.popup.syncStudents' || message?.type === 'kings.popup.syncStudentDirectory') {
      ext.logDebug('popup', 'sync_students_clicked')
      return actions.runVisibleAction('sync_students', actions.syncStudentsApi)
    }

    if (message?.type === 'kings.popup.syncClasses' || message?.type === 'kings.popup.syncSchoolGroupsApi') {
      ext.logDebug('popup', 'sync_classes_clicked')
      return actions.runVisibleAction('sync_classes', actions.syncClassesApi)
    }

    if (message?.type === 'kings.popup.importMappedClasses') {
      ext.logDebug('popup', 'import_mapped_classes_clicked')
      return actions.runVisibleAction('import_mapped_classes', actions.importMappedClasses)
    }

    if (message?.type === 'kings.popup.syncSchoolGroupsScrape') {
      ext.logDebug('popup', 'sync_school_groups_scrape_clicked')
      return actions.syncSchoolGroupsScrape()
    }

    if (message?.type === 'kings.popup.syncReportingClass') {
      ext.logDebug('popup', 'sync_reporting_clicked')
      return actions.syncReportingClass()
    }

    if (message?.type === 'kings.popup.getDebugLogs') {
      return ext.getDebugLogs()
    }

    if (message?.type === 'kings.popup.clearDebugLogs') {
      return ext.clearDebugLogs()
    }

    return undefined
  })
}
