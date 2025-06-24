export const ASTRONOMICAL_DATA = {
    sun: {
        realRadius: 696340, // km
        realMass: 1.989e30, // kg
        realDensity: 1408, // kg/m³
        realTemperature: 5778, // K surface temperature
        realAge: 4.6e9, // years
        realComposition: "73% Hydrogen, 25% Helium, 2% Other",
        realGravity: 274, // m/s²
        realEscapeVelocity: 617.5, // km/s
        description: {
            title: "The Sun ☀️",
            subtitle: "Our Neighborhood's Nuclear Furnace",
            facts: [
                "🔥 **Hot Stuff**: At 5,778K surface temperature, the Sun could melt literally everything on Earth. Its core? A toasty 15 million degrees. That's hot enough to make physicists sweat just thinking about it.",
                "⚛️ **Fusion Factory**: Every second, the Sun converts 600 million tons of hydrogen into helium through nuclear fusion. It's basically the universe's most powerful energy drink mixer.",
                "🌍 **Size Matters**: You could fit 1.3 million Earths inside the Sun. If Earth were a marble, the Sun would be a beach ball that's really, really angry.",
                "💡 **Ancient Light**: The light hitting your face right now started its journey from the Sun's core about 100,000 years ago. It's older than human civilization!",
                "🎯 **Perfect Distance**: We're in the 'Goldilocks Zone' - not too hot, not too cold. Move us 5% closer and we'd be Venus. Move us 15% farther and we'd be Mars. The universe has excellent interior design skills."
            ],
            funFact: "The Sun loses 4 million tons of mass every second due to nuclear fusion, but don't worry - it has enough fuel to keep shining for another 5 billion years. That's longer than most warranties!"
        }
    },
    mercury: {
        realRadius: 2439.7, // km
        realMass: 3.301e23, // kg
        realDensity: 5427, // kg/m³
        realTemperature: { day: 700, night: -173 }, // K
        realOrbitalPeriod: 87.97, // days
        realRotationPeriod: 58.646, // days
        realGravity: 3.7, // m/s²
        realEscapeVelocity: 4.25, // km/s
        realDistanceFromSun: 57.9e6, // km
        description: {
            title: "Mercury ☿️",
            subtitle: "The Solar System's Speed Demon",
            facts: [
                "🏃‍♂️ **Speed Racer**: Mercury orbits the Sun at 47.87 km/s - that's fast enough to circle Earth in 14 minutes. It makes Formula 1 cars look like they're standing still.",
                "🌡️ **Bipolar Weather**: Daytime temperatures reach 427°C (hot enough to melt lead), while nighttime drops to -173°C. It's like living in an oven that someone keeps putting in the freezer.",
                "🌍 **Tiny but Dense**: Mercury is only slightly larger than our Moon, but it's packed with a massive iron core that makes up 75% of its radius. It's basically a cannonball pretending to be a planet.",
                "🌅 **Weird Days**: A day on Mercury (sunrise to sunrise) lasts 176 Earth days, but its year is only 88 Earth days. You'd celebrate your birthday twice before seeing one sunset!",
                "🎯 **Cratered Veteran**: Mercury's surface is covered in impact craters from billions of years of cosmic bombardment. It's like the universe's punching bag, but it keeps on spinning."
            ],
            funFact: "If you weigh 100 kg on Earth, you'd weigh only 38 kg on Mercury. Unfortunately, you'd also be either melting or frozen solid, so the weight loss wouldn't be very useful!"
        }
    },
    venus: {
        realRadius: 6051.8, // km
        realMass: 4.867e24, // kg
        realDensity: 5243, // kg/m³
        realTemperature: 737, // K surface temperature
        realOrbitalPeriod: 224.7, // days
        realRotationPeriod: -243.025, // days (retrograde)
        realGravity: 8.87, // m/s²
        realEscapeVelocity: 10.36, // km/s
        realDistanceFromSun: 108.2e6, // km
        realAtmosphere: "96.5% CO₂, 3.5% N₂",
        description: {
            title: "Venus ♀️",
            subtitle: "Earth's Evil Twin Sister",
            facts: [
                "🔥 **Hellish Greenhouse**: Venus is hotter than Mercury despite being farther from the Sun, thanks to a runaway greenhouse effect. Its 96% CO₂ atmosphere traps heat like a cosmic pressure cooker.",
                "🌪️ **Backwards Spinner**: Venus rotates backwards (retrograde) and so slowly that a day lasts 243 Earth days. It's the solar system's rebel without a cause.",
                "☔ **Acid Rain**: Venus has clouds of concentrated sulfuric acid. It's like nature decided to create the most hostile chemistry lab possible and call it a planet.",
                "💎 **Diamond Rain Theory**: The extreme pressure and temperature might create diamond rain in the upper atmosphere. Even the weather is expensive on Venus!",
                "🌍 **Earth's Twin**: Venus is almost identical to Earth in size and mass, earning it the nickname 'Earth's twin.' It's more like Earth's evil twin who went completely off the rails."
            ],
            funFact: "Venus is the hottest planet in our solar system at 462°C surface temperature. That's hot enough to melt zinc, lead, and any hopes of a pleasant vacation!"
        }
    },
    earth: {
        realRadius: 6371, // km
        realMass: 5.972e24, // kg
        realDensity: 5514, // kg/m³
        realTemperature: 288, // K average surface temperature
        realOrbitalPeriod: 365.256, // days
        realRotationPeriod: 0.99726968, // days
        realGravity: 9.807, // m/s²
        realEscapeVelocity: 11.186, // km/s
        realDistanceFromSun: 149.6e6, // km
        realAtmosphere: "78% N₂, 21% O₂, 1% Other",
        description: {
            title: "Earth 🌍",
            subtitle: "The Pale Blue Dot (Our Home Sweet Home)",
            facts: [
                "💧 **Water World**: 71% of Earth's surface is covered in water, and we've explored less than 5% of our oceans. We know more about the surface of Mars than our own ocean floor!",
                "🌍 **Goldilocks Planet**: Earth sits in the perfect 'habitable zone' - not too hot, not too cold, but just right for liquid water and life. The universe's best real estate!",
                "🛡️ **Magnetic Shield**: Our magnetic field deflects harmful solar radiation, creating beautiful auroras and keeping us from becoming cosmic toast. Thanks, molten iron core!",
                "🌙 **Moon Partnership**: Our unusually large Moon stabilizes Earth's tilt, giving us stable seasons and preventing climate chaos. It's the ultimate cosmic wingman.",
                "🧬 **Life Central**: Earth is the only known planet with life, hosting an estimated 8.7 million species. We're basically the universe's most exclusive party, and everyone's invited!"
            ],
            funFact: "Earth is the densest planet in our solar system, and the only one not named after a Roman god. We're rebels who named our planet 'dirt' in Old English!"
        }
    },
    moon: {
        realRadius: 1737.4, // km
        realMass: 7.342e22, // kg
        realDensity: 3344, // kg/m³
        realTemperature: { day: 396, night: 40 }, // K
        realOrbitalPeriod: 27.322, // days
        realRotationPeriod: 27.322, // days (tidally locked)
        realGravity: 1.62, // m/s²
        realEscapeVelocity: 2.38, // km/s
        realDistanceFromEarth: 384400, // km
        description: {
            title: "The Moon 🌙",
            subtitle: "Earth's Faithful Companion",
            facts: [
                "🎭 **Two-Faced**: The Moon is tidally locked, so we always see the same side. The 'dark side' isn't actually dark - it just doesn't like to socialize with Earth.",
                "🌊 **Tide Master**: The Moon's gravity creates our ocean tides, moving trillions of tons of water twice daily. It's the ultimate cosmic choreographer.",
                "🏌️ **Low Gravity Golf**: With 1/6th Earth's gravity, astronaut Alan Shepard hit a golf ball that traveled for miles. The Moon: where everyone's a pro golfer!",
                "🌍 **Stabilizing Force**: Without the Moon, Earth would wobble chaotically, causing extreme climate swings. Our Moon keeps us steady like a cosmic gyroscope.",
                "📏 **Perfect Coincidence**: The Moon appears the same size as the Sun in our sky (during eclipses) due to an incredible cosmic coincidence. What are the odds?"
            ],
            funFact: "The Moon is moving away from Earth at 3.8 cm per year - about the same rate your fingernails grow. Don't worry, it'll take 50 billion years to escape!"
        }
    },
    mars: {
        realRadius: 3389.5, // km
        realMass: 6.39e23, // kg
        realDensity: 3933, // kg/m³
        realTemperature: 210, // K average surface temperature
        realOrbitalPeriod: 686.98, // days
        realRotationPeriod: 1.025957, // days
        realGravity: 3.71, // m/s²
        realEscapeVelocity: 5.03, // km/s
        realDistanceFromSun: 227.9e6, // km
        realAtmosphere: "95% CO₂, 3% N₂, 2% Other",
        description: {
            title: "Mars ♂️",
            subtitle: "The Red Planet (Future Human Backup Drive)",
            facts: [
                "🔴 **Rust Bucket**: Mars is red because its surface is covered in iron oxide (rust). It's basically a planet-sized rusty car that's been sitting in the cosmic driveway for billions of years.",
                "🏔️ **Mountain High**: Olympus Mons is the largest volcano in the solar system - 21 km tall and 600 km wide. It makes Mount Everest look like a speed bump.",
                "❄️ **Polar Ice Caps**: Mars has polar ice caps made of water and frozen CO₂ (dry ice). It's like having snow cones at both ends of the planet.",
                "🌪️ **Dust Storm Planet**: Mars can have planet-wide dust storms that last for months. Imagine the worst sandstorm on Earth, then multiply by 'entire planet.'",
                "🚀 **Future Home**: Mars is our best bet for becoming a multi-planetary species. It's like Earth's fixer-upper cousin - needs work, but has potential!"
            ],
            funFact: "A day on Mars is 24 hours and 37 minutes - almost identical to Earth! It's like the universe designed Mars as Earth's weekend getaway destination."
        }
    },
    phobos: {
        realRadius: 11.3, // km (mean radius)
        realMass: 1.0659e16, // kg
        realDensity: 1876, // kg/m³
        realOrbitalPeriod: 0.31891, // days
        realRotationPeriod: 0.31891, // days (tidally locked)
        realGravity: 0.0057, // m/s²
        realEscapeVelocity: 0.0114, // km/s
        realDistanceFromMars: 9376, // km
        description: {
            title: "Phobos 🌑",
            subtitle: "Mars' Doomed Moon (The Cosmic Speed Demon)",
            facts: [
                "⚡ **Speed Demon**: Phobos orbits Mars in just 7.6 hours - faster than Mars rotates! From Mars' surface, you'd see Phobos rise in the west and set in the east twice per day.",
                "💀 **Doomed Moon**: Phobos is spiraling into Mars at 1.8 cm per year. In 50 million years, it'll either crash into Mars or break apart into a ring system. Talk about a deadline!",
                "🥔 **Potato Moon**: Phobos is shaped like a lumpy potato, measuring 27×22×18 km. It's too small for gravity to make it round - cosmic potatoes don't follow the rules.",
                "🪨 **Asteroid Captive**: Phobos is likely a captured asteroid. Mars basically said 'You're mine now' to a passing space rock.",
                "🏃‍♂️ **Escape Velocity**: You could literally throw a baseball off Phobos and it would escape into space. The escape velocity is only 41 km/h - slower than highway speed!"
            ],
            funFact: "If you weigh 70 kg on Earth, you'd weigh only 40 grams on Phobos - less than a slice of bread! You could jump 3 km high, assuming you didn't accidentally achieve orbit."
        }
    },
    deimos: {
        realRadius: 6.2, // km (mean radius)
        realMass: 1.4762e15, // kg
        realDensity: 1471, // kg/m³
        realOrbitalPeriod: 1.263, // days
        realRotationPeriod: 1.263, // days (tidally locked)
        realGravity: 0.003, // m/s²
        realEscapeVelocity: 0.0056, // km/s
        realDistanceFromMars: 23463, // km
        description: {
            title: "Deimos 🌑",
            subtitle: "Mars' Tiny, Distant Companion",
            facts: [
                "🔍 **Barely There**: Deimos is so small (15×12×11 km) that from Mars' surface, it looks like a bright star. It's the solar system's most underwhelming moon.",
                "🐌 **Slow Mover**: Unlike speedy Phobos, Deimos takes 30 hours to orbit Mars - longer than a Martian day. It's the cosmic equivalent of a lazy Sunday.",
                "🪨 **Rubble Pile**: Deimos is likely just a loose collection of rocks held together by weak gravity. It's basically a cosmic beanbag chair.",
                "🌌 **Escape Artist**: Deimos is slowly moving away from Mars, unlike doomed Phobos. In the distant future, it might escape Mars entirely and become an asteroid again.",
                "🏃‍♂️ **Super Jump**: With gravity 1/300th of Earth's, you could jump over 5 km high on Deimos. You'd probably achieve orbit by accident while trying to hop over a small rock!"
            ],
            funFact: "Deimos was almost not discovered because it's so small and close to Mars in the sky. It's like trying to spot a grain of sand next to a basketball!"
        }
    },
    jupiter: {
        realRadius: 69911, // km
        realMass: 1.898e27, // kg
        realDensity: 1326, // kg/m³
        realTemperature: 165, // K average temperature
        realOrbitalPeriod: 4332.59, // days (11.86 years)
        realRotationPeriod: 0.41354, // days
        realGravity: 24.79, // m/s²
        realEscapeVelocity: 59.5, // km/s
        realDistanceFromSun: 778.5e6, // km
        realAtmosphere: "89% H₂, 10% He, 1% Other",
        description: {
            title: "Jupiter ♃",
            subtitle: "The Solar System's Gentle Giant and Cosmic Vacuum Cleaner",
            facts: [
                "🛡️ **Cosmic Bodyguard**: Jupiter acts as the solar system's vacuum cleaner, using its massive gravity to deflect or capture asteroids and comets that might threaten inner planets. Thanks, big guy!",
                "🌪️ **Storm King**: The Great Red Spot is a storm larger than Earth that's been raging for at least 400 years. It's like a hurricane that refuses to take a vacation.",
                "💎 **Diamond Rain**: Jupiter's extreme pressure might create diamond rain in its atmosphere. Even the weather is luxurious on Jupiter!",
                "🌙 **Moon Collector**: Jupiter has 95 known moons, including the four Galilean moons discovered in 1610. It's like the solar system's moon hoarder.",
                "⚖️ **Failed Star**: Jupiter contains more mass than all other planets combined, but it needed to be 80 times more massive to become a star. Close, but no cosmic cigar!"
            ],
            funFact: "Jupiter is so massive that it doesn't actually orbit the Sun - both Jupiter and the Sun orbit around their common center of mass, which is just outside the Sun's surface!"
        }
    },
    io: {
        realRadius: 1821.6, // km
        realMass: 8.932e22, // kg
        realDensity: 3528, // kg/m³
        realTemperature: 110, // K average surface temperature
        realOrbitalPeriod: 1.769, // days
        realRotationPeriod: 1.769, // days (tidally locked)
        realGravity: 1.796, // m/s²
        realEscapeVelocity: 2.558, // km/s
        realDistanceFromJupiter: 421700, // km
        description: {
            title: "Io 🌋",
            subtitle: "The Solar System's Pizza Moon (Volcanic Wonderland)",
            facts: [
                "🌋 **Volcanic Hellscape**: Io has over 400 active volcanoes, making it the most volcanically active body in the solar system. It's like living on a cosmic pizza with extra pepperoni.",
                "🎨 **Colorful Character**: Io's surface is painted in yellows, reds, and oranges from sulfur compounds. It looks like someone spilled a cosmic paint set.",
                "🌊 **Tidal Torture**: Jupiter's massive gravity constantly squeezes and stretches Io, generating the heat that drives its volcanism. It's cosmic stress taken to the extreme.",
                "💨 **Sulfur Geysers**: Volcanic plumes on Io can shoot 500 km high - that's like a geyser reaching the International Space Station from Earth's surface!",
                "🏔️ **Mountain Builder**: Despite constant volcanic resurfacing, Io has mountains up to 17.5 km tall. They're not volcanic - they're created by tectonic compression."
            ],
            funFact: "Io's volcanoes are so active that the entire surface is completely renewed every million years or so. It's the ultimate home renovation project!"
        }
    },
    europa: {
        realRadius: 1560.8, // km
        realMass: 4.8e22, // kg
        realDensity: 3013, // kg/m³
        realTemperature: 102, // K average surface temperature
        realOrbitalPeriod: 3.551, // days
        realRotationPeriod: 3.551, // days (tidally locked)
        realGravity: 1.314, // m/s²
        realEscapeVelocity: 2.025, // km/s
        realDistanceFromJupiter: 671034, // km
        description: {
            title: "Europa ❄️",
            subtitle: "The Ocean Moon (Potential Alien Beach Resort)",
            facts: [
                "🌊 **Hidden Ocean**: Beneath Europa's icy crust lies an ocean containing twice as much water as all Earth's oceans combined. It's the ultimate hidden swimming pool!",
                "🏒 **Ice Skating Rink**: Europa's surface is covered in smooth ice with fascinating crack patterns. It's like Jupiter's personal ice skating rink, but with potential aliens.",
                "🐠 **Life Potential**: Europa's subsurface ocean might harbor life. If aliens exist there, they'd be the ultimate deep-sea creatures - no sunlight for billions of years!",
                "💧 **Water Geysers**: Europa shoots water plumes up to 200 km high through cracks in its ice. It's like the moon is doing cosmic whale impressions.",
                "🌡️ **Tidal Heating**: Jupiter's gravity keeps Europa's ocean liquid through tidal heating. It's cosmic central heating powered by gravitational stress!"
            ],
            funFact: "Europa's ocean is estimated to be 60-150 km deep - that's 10 times deeper than Earth's deepest ocean trench. Mariana Trench, meet your big sister!"
        }
    },
    ganymede: {
        realRadius: 2634.1, // km
        realMass: 1.482e23, // kg
        realDensity: 1936, // kg/m³
        realTemperature: 110, // K average surface temperature
        realOrbitalPeriod: 7.155, // days
        realRotationPeriod: 7.155, // days (tidally locked)
        realGravity: 1.428, // m/s²
        realEscapeVelocity: 2.741, // km/s
        realDistanceFromJupiter: 1070412, // km
        description: {
            title: "Ganymede 🌑",
            subtitle: "The Solar System's Largest Moon (Bigger Than Mercury!)",
            facts: [
                "🏆 **Size Champion**: Ganymede is the largest moon in the solar system - bigger than Mercury and 3/4 the size of Mars. It's the moon that could have been a planet!",
                "🧲 **Magnetic Personality**: Ganymede is the only moon with its own magnetic field, creating beautiful auroras at its poles. It's like a mini-Earth with cosmic light shows.",
                "🌊 **Sandwich Ocean**: Ganymede has a subsurface ocean sandwiched between layers of ice. It's like a cosmic ice cream sandwich, but with potential for life!",
                "🎭 **Two-Faced Terrain**: Half of Ganymede is dark, cratered terrain, while the other half is bright, grooved terrain. It can't decide if it wants to be old or young.",
                "🛰️ **Future Destination**: ESA's JUICE mission will orbit Ganymede in 2034, making it the first spacecraft to orbit a moon other than our own. Ganymede is getting its own space taxi!"
            ],
            funFact: "If Ganymede orbited the Sun instead of Jupiter, it would definitely be classified as a planet. It's basically a planet that chose to be Jupiter's sidekick instead!"
        }
    },
    callisto: {
        realRadius: 2410.3, // km
        realMass: 1.076e23, // kg
        realDensity: 1834, // kg/m³
        realTemperature: 134, // K average surface temperature
        realOrbitalPeriod: 16.689, // days
        realRotationPeriod: 16.689, // days (tidally locked)
        realGravity: 1.235, // m/s²
        realEscapeVelocity: 2.440, // km/s
        realDistanceFromJupiter: 1882709, // km
        description: {
            title: "Callisto 🌑",
            subtitle: "The Ancient Punching Bag (Most Cratered Body in the Solar System)",
            facts: [
                "🎯 **Crater Champion**: Callisto is the most heavily cratered body in the solar system. It's like the universe's dartboard - everything that flies by takes a shot at it.",
                "🕰️ **Ancient Surface**: Callisto's surface is 4 billion years old and virtually unchanged. It's like a cosmic museum of early solar system history.",
                "🌊 **Secret Ocean**: Despite its battered appearance, Callisto likely has a subsurface ocean. Even the most beaten-up moon can have hidden depths!",
                "🛡️ **Radiation Safe**: Callisto orbits outside Jupiter's main radiation belts, making it the safest Galilean moon for future human missions. It's the cosmic equivalent of a safe neighborhood.",
                "🌌 **Outsider Moon**: Callisto is so far from Jupiter that it barely feels tidal heating. It's the introvert of Jupiter's major moons."
            ],
            funFact: "Callisto has so many craters that there's no room for new ones - new impacts just hit old craters. It's reached maximum crater capacity!"
        }
    },
    saturn: {
        realRadius: 58232, // km
        realMass: 5.683e26, // kg
        realDensity: 687, // kg/m³
        realTemperature: 134, // K average temperature
        realOrbitalPeriod: 10759.22, // days (29.46 years)
        realRotationPeriod: 0.444, // days
        realGravity: 10.44, // m/s²
        realEscapeVelocity: 35.5, // km/s
        realDistanceFromSun: 1432e6, // km
        realAtmosphere: "96% H₂, 3% He, 1% Other",
        description: {
            title: "Saturn ♄",
            subtitle: "The Lord of the Rings (Cosmic Jewelry Showoff)",
            facts: [
                "💍 **Ring Master**: Saturn's rings are made of billions of ice and rock particles, from tiny grains to house-sized chunks. It's like cosmic jewelry on steroids.",
                "🏊‍♂️ **Floater**: Saturn is less dense than water - it would float in a cosmic bathtub! Too bad there's no bathtub big enough to test this theory.",
                "🌪️ **Hexagon Mystery**: Saturn has a perfect hexagonal storm at its north pole. Nature apparently enjoys geometry when it's bored.",
                "🌙 **Moon Shepherd**: Saturn has 146 known moons, including Titan with its thick atmosphere and methane lakes. It's like having a whole solar system as a family.",
                "⚡ **Lightning Bolts**: Saturn has lightning bolts 10,000 times more powerful than Earth's. Even its weather is more dramatic than ours!"
            ],
            funFact: "Saturn's rings are incredibly thin - only about 10 meters thick on average. If Saturn were the size of a basketball, its rings would be thinner than a sheet of paper!"
        }
    },
    titan: {
        realRadius: 2574, // km
        realMass: 1.345e23, // kg
        realDensity: 1880, // kg/m³
        realTemperature: 94, // K average surface temperature
        realOrbitalPeriod: 15.945, // days
        realRotationPeriod: 15.945, // days (tidally locked)
        realGravity: 1.352, // m/s²
        realEscapeVelocity: 2.639, // km/s
        realDistanceFromSaturn: 1221830, // km
        realAtmosphere: "98.4% N₂, 1.6% CH₄",
        description: {
            title: "Titan 🌫️",
            subtitle: "Saturn's Mysterious Smoggy Moon (Earth's Weird Cousin)",
            facts: [
                "🌫️ **Smog World**: Titan has a thick, orange atmosphere that's 4 times denser than Earth's. It's like living inside a cosmic orange soda bottle.",
                "🏞️ **Methane Lakes**: Titan has lakes and rivers of liquid methane and ethane. It's the only other body in the solar system with stable surface liquids - just not the kind you'd want to drink!",
                "🌧️ **Hydrocarbon Rain**: It rains methane on Titan. Imagine explaining that weather forecast: 'Cloudy with a chance of rocket fuel.'",
                "🌍 **Earth-like Processes**: Titan has weather patterns, erosion, and even sand dunes - but everything is made of hydrocarbons instead of water and rock.",
                "🛰️ **Huygens Landing**: In 2005, the Huygens probe landed on Titan, revealing a world that looks surprisingly Earth-like, just with different chemistry."
            ],
            funFact: "Titan's atmosphere is so thick and its gravity so low that humans could fly by flapping artificial wings! It's the only place in the solar system where human-powered flight would work."
        }
    },
    uranus: {
        realRadius: 25362, // km
        realMass: 8.681e25, // kg
        realDensity: 1271, // kg/m³
        realTemperature: 76, // K average temperature
        realOrbitalPeriod: 30688.5, // days (84.01 years)
        realRotationPeriod: -0.71833, // days (retrograde)
        realGravity: 8.69, // m/s²
        realEscapeVelocity: 21.3, // km/s
        realDistanceFromSun: 2867e6, // km
        realAtmosphere: "83% H₂, 15% He, 2% CH₄",
        description: {
            title: "Uranus ♅",
            subtitle: "The Sideways Planet (Solar System's Rebel)",
            facts: [
                "🔄 **Sideways Spinner**: Uranus rotates on its side with an axial tilt of 98°. It's like the planet decided to take a permanent nap while orbiting the Sun.",
                "❄️ **Ice Giant**: Uranus is made mostly of water, methane, and ammonia ices. It's basically a giant cosmic slushie that's really, really cold.",
                "💎 **Diamond Rain**: The extreme pressure inside Uranus might create diamond rain. Even the weather is expensive on ice giants!",
                "🌈 **Methane Blue**: Uranus appears blue-green due to methane in its atmosphere, which absorbs red light. It's the solar system's mood ring.",
                "🌙 **Faint Rings**: Uranus has 13 known rings, but they're much fainter than Saturn's. It's like Saturn's understated cousin who prefers subtle jewelry."
            ],
            funFact: "Due to its extreme tilt, each pole of Uranus experiences 42 years of continuous sunlight followed by 42 years of darkness. Talk about seasonal affective disorder!"
        }
    },
    neptune: {
        realRadius: 24622, // km
        realMass: 1.024e26, // kg
        realDensity: 1638, // kg/m³
        realTemperature: 72, // K average temperature
        realOrbitalPeriod: 60182, // days (164.8 years)
        realRotationPeriod: 0.6713, // days
        realGravity: 11.15, // m/s²
        realEscapeVelocity: 23.5, // km/s
        realDistanceFromSun: 4515e6, // km
        realAtmosphere: "80% H₂, 19% He, 1% CH₄",
        description: {
            title: "Neptune ♆",
            subtitle: "The Windy Blue Giant (Solar System's Storm King)",
            facts: [
                "💨 **Wind Champion**: Neptune has the fastest winds in the solar system, reaching 2,100 km/h. That's faster than the speed of sound on Earth!",
                "🔵 **Deep Blue**: Neptune's beautiful blue color comes from methane in its atmosphere. It's like the solar system's sapphire.",
                "🌪️ **Great Dark Spot**: Neptune had a storm the size of Earth called the Great Dark Spot, but it disappeared by the time Hubble looked for it. Even Neptune's storms are mysterious.",
                "🔥 **Hot Interior**: Despite being the coldest planet surface-wise, Neptune radiates 2.6 times more energy than it receives from the Sun. It's got some serious internal heating going on.",
                "🌙 **Triton's Backwards Dance**: Neptune's largest moon, Triton, orbits backwards and is slowly spiraling inward. It's probably a captured Kuiper Belt object."
            ],
            funFact: "Neptune takes 165 Earth years to complete one orbit. It only completed its first full orbit since discovery in 2011 - talk about being fashionably late!"
        }
    },
    pluto: {
        realRadius: 1188.3, // km
        realMass: 1.303e22, // kg
        realDensity: 1854, // kg/m³
        realTemperature: 44, // K average surface temperature
        realOrbitalPeriod: 90560, // days (248.09 years)
        realRotationPeriod: -6.387, // days (retrograde)
        realGravity: 0.62, // m/s²
        realEscapeVelocity: 1.212, // km/s
        realDistanceFromSun: 5906.4e6, // km (average)
        realAtmosphere: "N₂, CH₄, CO",
        description: {
            title: "Pluto 🌑",
            subtitle: "The Dwarf Planet with a Big Heart (Literally!)",
            facts: [
                "💔 **Demoted but Not Forgotten**: Pluto was reclassified as a dwarf planet in 2006, but it's still the king of the Kuiper Belt. Size isn't everything!",
                "❤️ **Heart-Shaped Feature**: Pluto has a heart-shaped nitrogen plain called Tombaugh Regio. Even dwarf planets can be romantic!",
                "🌙 **Double Planet**: Pluto and Charon are so close in size they're almost a double planet system, orbiting around their common center of mass.",
                "🌈 **Colorful Character**: Pluto's surface has a surprising variety of colors - from charcoal black to dark orange to white. It's like a cosmic paint palette.",
                "🥶 **Frozen Frontier**: At -230°C, Pluto is so cold that its atmosphere freezes and falls as snow when it's farther from the Sun."
            ],
            funFact: "A day on Pluto lasts 6.4 Earth days, and a year lasts 248 Earth years. If you were born on Pluto, you'd be less than 1 year old even if you lived to 100!"
        }
    },
    charon: {
        realRadius: 606, // km
        realMass: 1.586e21, // kg
        realDensity: 1702, // kg/m³
        realTemperature: 53, // K average surface temperature
        realOrbitalPeriod: 6.387, // days
        realRotationPeriod: 6.387, // days (tidally locked)
        realGravity: 0.288, // m/s²
        realEscapeVelocity: 0.580, // km/s
        realDistanceFromPluto: 19591, // km
        description: {
            title: "Charon 🌑",
            subtitle: "Pluto's Dancing Partner (The Ultimate Cosmic Couple)",
            facts: [
                "💃 **Tidal Tango**: Charon and Pluto are tidally locked to each other, always showing the same face. They're the ultimate cosmic dance partners, locked in eternal eye contact.",
                "🌍 **Relative Giant**: Charon is half the size of Pluto, making it the largest moon relative to its planet in the solar system. It's like having a friend who's almost as tall as you!",
                "🎭 **Two-Toned**: Charon has a dark polar cap made of organic compounds called tholins. It's like wearing a cosmic winter hat.",
                "🌊 **Ancient Ocean**: Charon might have had a subsurface ocean in the past that has since frozen. It's got a history of hidden depths.",
                "⚖️ **Balanced System**: The Pluto-Charon system is so balanced that they orbit around a point in space between them. They're the solar system's most egalitarian couple!"
            ],
            funFact: "From Pluto's surface, Charon would appear 8 times larger than our Moon appears from Earth, and it would never move in the sky - it would just hang there, staring back at you!"
        }
    }
};

// Format large numbers in scientific notation or with appropriate units
export function formatNumber(value, unit = '') {
    if (value >= 1e12) {
        return `${(value / 1e12).toFixed(2)} trillion ${unit}`.trim();
    } else if (value >= 1e9) {
        return `${(value / 1e9).toFixed(2)} billion ${unit}`.trim();
    } else if (value >= 1e6) {
        return `${(value / 1e6).toFixed(2)} million ${unit}`.trim();
    } else if (value >= 1e3) {
        return `${(value / 1e3).toFixed(2)} thousand ${unit}`.trim();
    } else if (value < 1 && value > 0) {
        return `${value.toFixed(4)} ${unit}`.trim();
    }
    return `${value.toLocaleString()} ${unit}`.trim();
}

// Format distance with appropriate units
export function formatDistance(km) {
    if (km >= 149597870.7) { // 1 AU
        const au = km / 149597870.7;
        return `${au.toFixed(3)} AU (${formatNumber(km, 'km')})`;
    } else if (km >= 1000) {
        return formatNumber(km, 'km');
    } else {
        return `${km.toFixed(1)} km`;
    }
}

// Format temperature with multiple units
export function formatTemperature(kelvin) {
    const celsius = kelvin - 273.15;
    const fahrenheit = celsius * 9/5 + 32;
    
    if (typeof kelvin === 'object') {
        // Handle day/night temperatures
        return `${Math.round(kelvin.day - 273.15)}°C day / ${Math.round(kelvin.night - 273.15)}°C night`;
    }
    
    return `${Math.round(celsius)}°C (${Math.round(fahrenheit)}°F, ${Math.round(kelvin)}K)`;
}

// Format time periods
export function formatTimePeriod(days) {
    if (days < 1) {
        const hours = days * 24;
        return `${hours.toFixed(1)} hours`;
    } else if (days < 365) {
        return `${days.toFixed(2)} days`;
    } else {
        const years = days / 365.25;
        return `${years.toFixed(2)} years`;
    }
}