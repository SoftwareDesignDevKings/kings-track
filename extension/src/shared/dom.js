(function () {
  self.KingsTrackExtension = self.KingsTrackExtension || {}
  const ext = self.KingsTrackExtension

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async function waitFor(predicate, timeoutMs) {
    const timeout = Date.now() + (timeoutMs || 5000)
    while (Date.now() < timeout) {
      const value = predicate()
      if (value) {
        return value
      }
      await wait(100)
    }
    throw new Error('Timed out waiting for Gradeo page state')
  }

  function getDropdownRoot(ariaLabel) {
    const trigger = document.querySelector(`[aria-label="${ariaLabel}"]`)
    if (!trigger) {
      throw new Error(`Could not find Gradeo dropdown "${ariaLabel}"`)
    }
    return trigger.closest('.p-dropdown') || trigger.parentElement
  }

  function getSelectedDropdownOption(ariaLabel) {
    const root = getDropdownRoot(ariaLabel)
    const select = root.querySelector('select')
    const option = select ? select.options[select.selectedIndex] : null
    const label = root.querySelector('.p-dropdown-label')?.textContent?.trim() || option?.textContent?.trim()
    return {
      id: option?.value || label,
      name: label,
      root,
    }
  }

  async function openDropdown(ariaLabel) {
    const root = getDropdownRoot(ariaLabel)
    const trigger = root.querySelector('[aria-label]') || root
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return waitFor(() => {
      const panels = Array.from(document.querySelectorAll('[role="listbox"], .p-dropdown-panel'))
      return panels.find(panel => panel && panel.getBoundingClientRect().height > 0)
    }, 3000)
  }

  async function listDropdownOptions(ariaLabel) {
    const panel = await openDropdown(ariaLabel)
    const options = Array.from(panel.querySelectorAll('[role="option"], .p-dropdown-item'))
      .map(option => ({
        id:
          option.getAttribute('data-value') ||
          option.getAttribute('data-p-value') ||
          option.getAttribute('data-id') ||
          option.getAttribute('aria-label') ||
          option.textContent.trim(),
        name: option.textContent.trim(),
        element: option,
      }))
      .filter(option => option.name)

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return options
  }

  async function selectDropdownOption(ariaLabel, optionSelector) {
    const panel = await openDropdown(ariaLabel)
    const optionName = optionSelector?.name || optionSelector
    const optionId = optionSelector && typeof optionSelector === 'object' ? optionSelector.id : null
    const option = Array.from(panel.querySelectorAll('[role="option"], .p-dropdown-item'))
      .find(node => {
        const nodeName = node.textContent.trim()
        const nodeId =
          node.getAttribute('data-value') ||
          node.getAttribute('data-p-value') ||
          node.getAttribute('data-id') ||
          node.getAttribute('aria-label')
        return (optionId && nodeId === optionId) || nodeName === optionName
      })
    if (!option) {
      throw new Error(`Could not find "${optionName}" in ${ariaLabel}`)
    }
    option.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wait(500)
    await waitFor(() => getSelectedDropdownOption(ariaLabel).name === optionName, 4000)
  }

  function findActionByText(pattern) {
    const nodes = Array.from(document.querySelectorAll('button, a'))
    return nodes.find(node => pattern.test(node.textContent || ''))
  }

  ext.wait = wait
  ext.waitFor = waitFor
  ext.getSelectedDropdownOption = getSelectedDropdownOption
  ext.listDropdownOptions = listDropdownOptions
  ext.selectDropdownOption = selectDropdownOption
  ext.findActionByText = findActionByText
})()
