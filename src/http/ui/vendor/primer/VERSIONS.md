# Vendored Primer files

GitHub's design system Primer, vendored as static files (decision D-MG-18): no npm runtime dependency, no build step.
All three packages are MIT licensed; each directory carries its LICENSE. Fetched with `npm pack` at the pinned versions below and copied unchanged.
Only the files the UI needs are vendored. To upgrade: `npm pack` the new version, copy the same files, and regenerate this table (sha256 of each file).
The test `test/ui-s0b-primer.test.ts` checks that every file below exists and matches its digest, and that no other file lies in this directory.

## @primer/primitives 11.10.0

https://www.npmjs.com/package/@primer/primitives

Source in the package: dist/css/functional/{themes,typography,size,spacing,motion}/*.css and dist/css/base/{size,typography}/*.css (renamed base-*.css)

| File | sha256 |
| --- | --- |
| `primitives/LICENSE` | e63582a78dddebe610b6cb59f0e7f5f761c1bb6a1c9551443beddc64fe525c3a |
| `primitives/base-size.css` | 84139b5ef4e09da469e360a928f23d62479a8b37e9ebbeabd5c9c3795b3fea60 |
| `primitives/base-typography.css` | 0564da8953da95586772ac617378280464f2bb59f880753f56d46f3ef92f9cf0 |
| `primitives/border.css` | 223a01cf4a8ff2fdf6c87e6eae88144406e082f019f43d1a18c712287de3ec2a |
| `primitives/dark.css` | d70cf0d4f3b2b1056030b40fcf1cd65b1d74d07dbbec002ad300e08266188d89 |
| `primitives/light.css` | 86468bdfa1761f189d7bed7c1a13c6183f67ec132d689dacc63acc9eec986496 |
| `primitives/motion.css` | 024532fe32dcdeb551921824dc1d870bc88e5f5577dc4d1510ed9a5fff4bc52a |
| `primitives/radius.css` | b0b77f22244ebff700ae01032abc16378bf19f713a7e56a880655f967d00e860 |
| `primitives/size.css` | 98c0a8cc23c939e100fba0a0e37299249d534f979d6da64629ad228416f5be64 |
| `primitives/space.css` | 4e9e6cdfd8f471af6fa26760ca82e4503d2f502ec23b465f4337c9f11926bd10 |
| `primitives/typography.css` | 62646c35ab2c5f73e7e8127307b1f8834a67a5f7e5cdfb3701cec70c0a147b82 |

## @primer/css 22.3.3

https://www.npmjs.com/package/@primer/css

Source in the package: dist/*.css (built, minified component styles)

| File | sha256 |
| --- | --- |
| `css/LICENSE` | e2719fc6fd67f6d25fea6cc263509bc517460a554248a8b87426e06e51ea4984 |
| `css/avatars.css` | 21c149750e7cfc6703ffe1fd2b5217319751901af9287666b7f84b7d774531c8 |
| `css/base.css` | bbfd23f5549105c01cddf45e3303b150d3a4350a7ea2e6441fb6c56ad452e802 |
| `css/box.css` | 4f4b78969ad803c4210976634b3ba36ffecb0affdadc665b80b109e07d097680 |
| `css/buttons.css` | b49a775cc46e6a1256b936a8ffcc295395c362cd024c1cc5d13161c8462b7e27 |
| `css/forms.css` | 4f226b43fce6dda6ce2cb47f6a62480be5d8965fc594e342426ebbc82b6ca0bc |
| `css/labels.css` | f97a2ee3af795bc89e156f2663533e70c0112a4effebc7804b7895c116351033 |
| `css/toasts.css` | 7d2cea0df614dfd23bc45751185903ed50c9bcf011b14f7e835381b2a3d0444a |
| `css/tooltips.css` | c5238f093fad8afa100d04ab2dc19579e6e00d29c8e71c319c9683480093ccc5 |

## @primer/octicons 19.42.0

https://www.npmjs.com/package/@primer/octicons

Source in the package: build/svg/*-16.svg (the 16 px set, only the icons the UI uses)

| File | sha256 |
| --- | --- |
| `octicons/LICENSE` | da259c8bd0de62713ccdcf88910aebca810644f98c2c912bad814fc79ea778df |
| `octicons/arrow-down-16.svg` | 1182ecaf24b95d99d8d94411e3e60e8c7e7fd1d3ce301cff661ea68de57f42de |
| `octicons/bell-16.svg` | be8c6f7119500995fb40880fab1f9a6b4a106a898126cea63906bdd22244bf84 |
| `octicons/book-16.svg` | eb260b9736df5b419b7896647693c970043347a01e518a685f9d7a308cde11c0 |
| `octicons/check-16.svg` | 03c83ce9419c3098e1056902f05f8c22336a51c7c8fcf90b66156b48c429fbef |
| `octicons/chevron-right-16.svg` | 2c1e6fe5281f25add8237832dfc59ebf69dfb76dc04469998be458614ca4996a |
| `octicons/comment-16.svg` | 1543da650f7940803ac965d976785d69170b88f9ce945e345cdaae7d2cf355c2 |
| `octicons/comment-discussion-16.svg` | 57ad74f91ab15d412624770cebd8f15e1df8421f7aab06f5e1a79c36502eeee7 |
| `octicons/copy-16.svg` | 1cd9f5bac41bedd0f295f981f47f49427d7e64c3ba1c40f8d93d94602f84f7b8 |
| `octicons/device-desktop-16.svg` | 189a55270363a39df86cfc28a3c88528c600725cc9bb9223b9b5937d6dd9c496 |
| `octicons/file-16.svg` | 2ad2fa8e3cd76c55cdd255ea84d9e2ef162b0045a3cbce8e9cfbc12a5179aade |
| `octicons/flame-16.svg` | 11493f4068f289f8c82ba110c64b515e4491bddd65927a7260a489fad28dac99 |
| `octicons/gear-16.svg` | f25378e59fd21d6f0bef66fc452828ef73aecc2794c17feb2cb999dc7095dcaa |
| `octicons/history-16.svg` | a3bfaab1589fffe6ee67f883261560d57f3e11b1da17857fa1b5fe0f2471aa96 |
| `octicons/inbox-16.svg` | 401576a5adb1fe4e3b0f06d409fbeb35efc15ebf6f3a7b9ee9ca2d8187677c9f |
| `octicons/info-16.svg` | dcac4886d4f30f13ef6db160ee011aa5d78f6a462ea7f3cdb68ef07e9c80e49f |
| `octicons/kebab-horizontal-16.svg` | 399cb0df0e3866709f80c2b15308ae89b67da64fc8cf9c30810c39008b23baf8 |
| `octicons/lock-16.svg` | 84dd3ef91514e77ae109b718b8ab009d55ba1d2b262c6f20164ac01d49a05581 |
| `octicons/moon-16.svg` | 031e5c4fd0e037b526a66f73a844d76ab7a9350435b4041757ae44da25531768 |
| `octicons/paper-airplane-16.svg` | d9346e4f99b87ee4dffa4cf5e88c6bcf206616ecace164a433ae5f8808be1d96 |
| `octicons/passkey-fill-16.svg` | fc9979ee51dc2c845707c11f95a63f75b6f2fbfc5712878899ef95d802f2f0d7 |
| `octicons/pencil-16.svg` | ccd73e107bd241feeed9239ccb3f65dc2fe5f1922d7f89f0231e76318227ed90 |
| `octicons/people-16.svg` | 89734ebcab9dcae9709d527518892d2d45ef31a3738782356059d6c99f02498b |
| `octicons/pin-16.svg` | 9e941bf98d502e618f435457fd86a11a8d2e6dcb1ae0f74d7a65a1f81915616b |
| `octicons/pin-slash-16.svg` | 6d77a51a50fece694670ba40b8d61539d2ea01688d5d4cfa6e5d46033ba85bb4 |
| `octicons/plus-16.svg` | 3d88857e85cd21f522e2238e9e01a2023c630c3037627485a5e513d1b8205b9a |
| `octicons/question-16.svg` | d642c9eff69e724bbcbf568d4107f1dd3150f02b6c2c19a016709a37ec81a9dc |
| `octicons/reply-16.svg` | 8c77d310b63ccb185c2de5a83b9247443beb9b417a28abde20fcc32f801ac503 |
| `octicons/search-16.svg` | af6571e5813e8c35feb5d94e6a1906a82ad30841f675956764af1f7205d6f4b8 |
| `octicons/shield-16.svg` | 9a7cd50763dee1456848e0e5bafa07f12f34c3fecd3dad1b3553318971e54504 |
| `octicons/sign-out-16.svg` | 06841599472db48cfea46dbfc8daf512a3da5eb6ca6edad2a6bb5cf3de1b1703 |
| `octicons/smiley-16.svg` | 488fdf34a41f1f69eff272597aea423e0487945bf5ec7b11d76f42e8cd82cfd8 |
| `octicons/sun-16.svg` | fabea2ac14f4923ed5b17b28d8cb78f2514661ef50089376f10583f3bc101cb2 |
| `octicons/three-bars-16.svg` | 55a77c2e744f2139f18000cef9db49573a025e4ddc35db8bf95bfb18ca9fc73d |
| `octicons/tools-16.svg` | cd1dcd756ef95b2dbfcbb90266e7396ddc8acdcee7d9db9a90a98f260c912d84 |
| `octicons/trash-16.svg` | 91094961480d58395b6f9a0264dc32e90de4063e856602cb7ee1cda230cbbeb0 |
| `octicons/x-16.svg` | d48518fbcd53f6c3162de358192d295fde4a4b5df80fbe458d23c8cab7b97f1e |

## Top level

| File | sha256 |
| --- | --- |
| `LICENSE` | da259c8bd0de62713ccdcf88910aebca810644f98c2c912bad814fc79ea778df |
