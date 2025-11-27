import { memo } from 'react'
import { motion } from 'framer-motion'
import { Icon } from '../../components/run/ui.jsx'
import {
  canonicalStepType,
  formatFileLabel,
  formatStepFunctionLabel,
  getStepColor,
  getStepIcon,
  isLoopLikeType,
} from './traceUtils.js'

const ExecutionStepNode = memo(({ step, index, isActive, isCurrent, onClick, totalSteps }) => {
  const { type, line, file, fileLabel, code, depth, func, isCall, isReturn, kind, isLoop, isEntry, isExit, isBranch } = step
  const iconName = getStepIcon(type)
  const normalizedType = kind || canonicalStepType(type)
  const color = getStepColor(normalizedType)
  const indentPx = (depth || 0) * 32
  const loopStep = typeof isLoop === 'boolean' ? isLoop : isLoopLikeType(normalizedType)
  const displayFile = fileLabel || formatFileLabel(file)
  const locationTitle = file || fileLabel || displayFile || ''
  const funcLabel = formatStepFunctionLabel(func)
  const showFuncLabel = funcLabel && funcLabel !== '<module>'
  
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.5) }}
      className={`oc-exec-step ${isActive ? 'oc-exec-step-active' : ''} ${isCurrent ? 'oc-exec-step-current' : ''}`}
      style={{ '--step-color': color, '--step-indent': `${indentPx}px` }}
      onClick={onClick}
      data-entry={isEntry ? 'true' : undefined}
      data-exit={isExit ? 'true' : undefined}
      data-branch={isBranch ? 'true' : undefined}
      data-loop={loopStep ? 'true' : undefined}
    >
      {/* Vertical connector line */}
      {index < totalSteps - 1 && (
        <div className="oc-exec-connector" style={{ left: `calc(20px + ${indentPx}px)` }} />
      )}
      
      {/* Step number */}
      <div className="oc-exec-step-num">{index + 1}</div>
      
      {/* Indented content wrapper */}
      <div className="oc-exec-step-indent" style={{ paddingLeft: `${indentPx}px` }}>
        {/* Node circle with icon */}
        <div className="oc-exec-step-node" style={{ background: color }}>
          <Icon name={iconName} className="size-3.5" strokeWidth={2.5} />
        </div>
        
        {/* Step content */}
        <div className="oc-exec-step-content">
          {/* Header: function context + line number */}
          <div className="oc-exec-step-header">
            {showFuncLabel && (
              <span className="oc-exec-step-func">
                <Icon name="node-function" className="size-3 inline mr-1" />
                <span>{funcLabel}</span>
                <span aria-hidden="true">()</span>
              </span>
            )}
            {isCall && (
              <span className="oc-exec-step-badge oc-exec-step-badge-call">
                <Icon name="arrow-right" className="size-2.5" /> CALL
              </span>
            )}
            {loopStep && (
              <span className="oc-exec-step-badge oc-exec-step-badge-loop">
                <Icon name="node-loop" className="size-2.5" /> LOOP
              </span>
            )}
            {isReturn && (
              <span className="oc-exec-step-badge oc-exec-step-badge-return">
                <Icon name="arrow-left" className="size-2.5" /> RETURN
              </span>
            )}
            <span className="oc-exec-step-loc" title={locationTitle || undefined}>
              {displayFile && <span className="opacity-70">{displayFile}:</span>}
              <span className="font-semibold">L{line}</span>
            </span>
          </div>
          
          {/* Code preview */}
          {code && (
            <div className="oc-exec-step-code">
              <code>{code}</code>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
})

ExecutionStepNode.displayName = 'ExecutionStepNode'

export default ExecutionStepNode
