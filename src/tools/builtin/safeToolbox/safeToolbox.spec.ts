import { defineTool } from '../../tool'
import { createSafeToolbox, withSafeToolbox } from './safeToolbox'

describe('withSafeToolbox', () => {
    const callContext = { error: new Error('boom'), args: [] }
    const safeToolbox = createSafeToolbox(callContext)

    const lookupTool = defineTool({
        name: 'lookup_order',
        description: 'Look up an order',
        execute: (): string => 'order',
    })

    it('puts the safe toolbox ahead of the investigation tools by default', () => {
        expect(withSafeToolbox(callContext, [lookupTool])?.map(tool => tool.name)).toEqual([...safeToolbox.map(tool => tool.name), 'lookup_order'])
        expect(withSafeToolbox(callContext, undefined)?.map(tool => tool.name)).toEqual(safeToolbox.map(tool => tool.name))
    })

    it('leaves the investigation tools alone when the safe toolbox is not allowed', () => {
        expect(withSafeToolbox(callContext, [lookupTool], false)).toEqual([lookupTool])
        expect(withSafeToolbox(callContext, undefined, false)).toBeUndefined()
    })
})
