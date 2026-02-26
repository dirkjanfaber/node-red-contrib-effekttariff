## Description

<!-- Briefly describe what this PR does -->

## Type of Change

<!-- Mark the relevant option with an [x] -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update
- [ ] Configuration/build changes

## Related Issues

<!-- Link any related issues using "Fixes #123" or "Relates to #123" -->

## Changes Made

<!-- List the main changes in bullet points -->

-

## Testing

<!-- Describe how you tested these changes -->

- [ ] I have run `npm test` and all tests pass
- [ ] I have added tests for new functionality (if applicable)
- [ ] I have tested with a real Node-RED instance (if applicable)

## Tariff Considerations

<!-- If this change affects tariff calculations, check the relevant boxes -->

- [ ] Not applicable (no tariff calculation changes)
- [ ] Tested with Sweden preset (3 peaks, 07:00-21:00, Nov-Mar)
- [ ] Tested with Flanders preset (15-min blocks, single peak, 24/7)
- [ ] Tested with night discount (nattsänkning)
- [ ] Tested with weekdays-only configuration
- [ ] Tested with threshold-based limiting (three-phase unbalanced)

## Roadmap / Docs

<!-- For releases or features that affect supported tariffs -->

- [ ] Not applicable
- [ ] `ROADMAP.md` updated with this change
- [ ] Relevant `docs/tariffs/*.md` files reviewed and updated if needed

## Checklist

- [ ] My code follows the project's coding style
- [ ] I have updated documentation if needed
- [ ] I have not removed backward compatibility (or discussed it first)
- [ ] My changes generate no new warnings from `npm run lint`
