export function getRequiredElement<T extends HTMLElement>(id: string) {
  const element = document.getElementById(id)
  if (!element) {
    throw new Error(`Missing popup element: ${id}`)
  }
  return element as T
}

export function getOptionalElement<T extends HTMLElement>(id: string) {
  return document.getElementById(id) as T | null
}

export function setButtonsBusy(buttonIds: string[], busy: boolean) {
  buttonIds.forEach((id) => {
    const button = getOptionalElement<HTMLButtonElement>(id)
    if (button) {
      button.disabled = busy
    }
  })
}
