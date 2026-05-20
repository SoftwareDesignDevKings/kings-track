import { render, screen } from '@testing-library/react'
import StatusBadge from '../components/StatusBadge'

describe('StatusBadge', () => {
  it('renders completed with emerald dot', () => {
    const { container } = render(<StatusBadge status="completed" />)
    const dot = container.querySelector('.bg-emerald-400')
    expect(dot).toBeInTheDocument()
  })

  it('renders in_progress with amber dot', () => {
    const { container } = render(<StatusBadge status="in_progress" />)
    const dot = container.querySelector('.bg-amber-400')
    expect(dot).toBeInTheDocument()
  })

  it('renders not_started with slate dot', () => {
    const { container } = render(<StatusBadge status="not_started" />)
    const dot = container.querySelector('.bg-slate-200')
    expect(dot).toBeInTheDocument()
  })

  it('renders excused with slate-300 dot', () => {
    const { container } = render(<StatusBadge status="excused" />)
    const dot = container.querySelector('.bg-slate-300')
    expect(dot).toBeInTheDocument()
  })

  it('tooltip includes score and points when both provided', () => {
    const { container } = render(
      <StatusBadge status="completed" score={85} pointsPossible={100} />
    )
    const wrapper = container.querySelector('[title]')
    expect(wrapper?.getAttribute('title')).toContain('85 / 100 pts')
  })

  it('tooltip appends Late and Missing flags', () => {
    const { container } = render(
      <StatusBadge status="completed" late={true} missing={true} />
    )
    const wrapper = container.querySelector('[title]')
    const title = wrapper?.getAttribute('title') ?? ''
    expect(title).toContain('Late')
    expect(title).toContain('Missing')
  })
})
