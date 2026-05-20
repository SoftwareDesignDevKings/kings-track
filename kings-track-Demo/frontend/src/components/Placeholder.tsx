interface PlaceholderProps {
  title: string
  description: string
  phase?: string
}

export default function Placeholder({ title, description, phase }: PlaceholderProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-4">
        <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
      </div>
      <h3 className="text-base font-medium text-slate-600 mb-1">{title}</h3>
      <p className="text-sm text-slate-400 max-w-xs">{description}</p>
      {phase && (
        <span className="mt-3 inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
          {phase}
        </span>
      )}
    </div>
  )
}
