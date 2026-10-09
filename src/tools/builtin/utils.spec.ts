import { defineTool } from '../tool'
import { withSafeTools } from './utils'
import { safeTools } from './safe'

describe('withSafeTools', () => {
    const lookupTool = defineTool({
        name: 'lookup_order',
        description: 'Look up an order',
        execute: (): string => 'order',
    })

    it('puts the safe tools ahead of the investigation tools by default', () => {
        expect(withSafeTools([lookupTool])).toEqual([...safeTools, lookupTool])
        expect(withSafeTools(undefined)).toEqual(safeTools)
    })

    it('leaves the investigation tools alone when safe tools are not allowed', () => {
        expect(withSafeTools([lookupTool], false)).toEqual([lookupTool])
        expect(withSafeTools(undefined, false)).toBeUndefined()
    })
})
