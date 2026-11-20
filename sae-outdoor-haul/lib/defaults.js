'use strict';
/**
 * Default settings + admin-only rates table.
 *
 * Every dollar amount the site shows comes from here (copied into data/settings.json
 * on first run, then edited from /admin). A value of `null` means "TODO: owner has not
 * set this yet". The estimate engine shows such lines as "To be confirmed" and never
 * makes up a number for them.
 *
 * Price shape: { min, max, plus }  ->  "$min", "$min to $max", or "$min+" / "$min to $max+".
 */

const p = (min, max = min, plus = false) => ({ min, max, plus });

function defaultSettings() {
  return {
    business: {
      name: 'SAE Outdoor and Haul',
      phone: '4696864690', // provided by owner
      textNumber: '4696864690', // TODO: confirm the text line is the same number as the phone
      email: null, // TODO: [EMAIL]
      baseAddress: 'Carrollton, TX', // owner: "centre of Carrollton"
      // Addresses whose geocoded city is in this list get a $0 distance fee.
      freeCities: ['Carrollton'],
      serviceAreaCities: [
        'Plano', 'Frisco', 'Irving', 'Richardson', 'Garland', 'Carrollton',
        'Farmers Branch', 'Addison', 'Lewisville', 'Denton', 'Coppell', 'Flower Mound',
      ],
    },
    content: {
      dontTake: null, // TODO: [CONFIRM LIST]
      needToBeHome: null, // TODO: [CONFIRM]
      paymentMethods: null, // TODO: [CONFIRM PAYMENT METHODS]
    },
    schedule: {
      timezone: 'America/Chicago',
      slotMinutes: 60, // each time slot is a 1-hour arrival window
      bookingWindowDays: 21, // how far ahead customers can book
      minLeadMinutes: 120, // same-day slots must start at least this far in the future
      // Hours by weekday (0 = Sunday ... 6 = Saturday). null = closed.
      hours: {
        0: { open: '10:00', close: '21:00' },
        1: { open: '17:00', close: '21:00' },
        2: { open: '17:00', close: '21:00' },
        3: { open: '17:00', close: '21:00' },
        4: { open: '17:00', close: '21:00' },
        5: { open: '17:00', close: '21:00' },
        6: { open: '10:00', close: '21:00' },
      },
      holidayHours: { open: '10:00', close: '21:00' },
      holidays: [], // TODO: [OWNER SETS DATES] e.g. "2026-12-25"
      blockedDates: [], // whole days closed
      blockedSlots: [], // { date, time } single slots closed
      openedSlots: [], // { date, time } extra slots opened outside normal hours
    },
    rates: {
      distance: {
        // Driving miles from the base address, rounded to the nearest whole mile.
        bands: [
          { label: '0 to 9 miles', maxMiles: 9, fee: null }, // TODO
          { label: '10 to 15 miles', maxMiles: 15, fee: null }, // TODO
          { label: '16 to 20 miles', maxMiles: 20, fee: null }, // TODO
          { label: '21 to 25 miles', maxMiles: 25, fee: null }, // TODO
        ],
        maxServiceMiles: 25,
      },
      junk: {
        minimumCharge: 100,
        loads: {
          minimum: { label: 'Minimum pickup', price: p(100) },
          quarter: { label: '1/4 load', price: p(150) },
          half: { label: '1/2 load', price: p(250) },
          threeQuarter: { label: '3/4 load', price: p(350) },
          full: { label: 'Full load', price: p(450, 550) },
          overFull: { label: 'Over full load (extra-heavy)', price: p(550, 700, true) },
        },
        items: {
          couch: { label: 'Couch', price: p(100, 150) },
          mattress: { label: 'Mattress', price: p(75, 110) },
          recliner: { label: 'Recliner', price: p(65, 90) },
          refrigerator: { label: 'Refrigerator', price: p(100, 150) },
          washerDryer: { label: 'Washer or dryer', price: p(75, 100) },
          diningSet: { label: 'Dining room set', price: p(125, 175) },
          bedFrame: { label: 'Bed frame', price: p(60, 90) },
          yardWaste: { label: 'Yard waste', price: p(100, 200) },
          constructionDebris: { label: 'Construction debris', price: p(150, 150, true) },
        },
        cleanouts: {
          smallGarage: { label: 'Small garage', price: p(200) },
          largeGarage: { label: 'Large garage', price: p(400, 650) },
          shed: { label: 'Shed', price: p(175, 350) },
          storageUnit: { label: 'Storage unit', price: p(200, 450) },
          apartment: { label: 'Apartment', price: p(300, 650) },
          house: { label: 'House', price: p(600, 1500, true) },
          rental: { label: 'Rental property', price: p(300, 800) },
        },
        extras: {
          heavyLifting: { label: 'Heavy lifting', price: p(25, 75) },
          stairs: { label: 'Stairs or difficult access', price: p(25, 75) },
          sameDay: { label: 'Same-day service', price: p(40) },
          disassembly: { label: 'Disassembly', price: p(25, 100) },
          longCarry: { label: 'Long carry', price: { min: null, max: null, plus: false } }, // TODO
        },
        notes: {
          specialDisposal: "Tires or special disposal: we'll confirm before pickup",
          heavyMaterials: "Concrete, dirt, or roofing: weight-based quote, we'll confirm",
        },
      },
      landscaping: {
        // price per visit; square footage counts mowable grass only
        back: {
          small: { label: 'Small backyard (0 to 1,500 sq ft)', price: p(30) },
          medium: { label: 'Medium backyard (1,501 to 3,000 sq ft)', price: p(40) },
          large: { label: 'Large backyard (3,001 to 5,000 sq ft)', price: p(55) },
        },
        front: {
          small: { label: 'Small front yard (0 to 1,000 sq ft)', price: p(30) },
          medium: { label: 'Medium front yard (1,001 to 2,000 sq ft)', price: p(35) },
          large: { label: 'Large front yard (2,001 to 3,500 sq ft)', price: p(45) },
        },
        both: {
          small: { label: 'Small front and back (0 to 2,500 sq ft total)', price: p(40) },
          medium: { label: 'Medium front and back (2,501 to 5,000 sq ft total)', price: p(55) },
          large: { label: 'Large front and back (5,001 to 8,500 sq ft total)', price: p(75) },
        },
      },
      trees: {
        sizes: {
          small: { label: 'Small (3 to 5 ft)' },
          medium: { label: 'Medium (6 to 7.5 ft)' },
          large: { label: 'Large (8 to 10 ft)' },
        },
        services: {
          delivery: 'Delivery only',
          installation: 'Installation only',
          both: 'Delivery and installation',
        },
        serviceFees: {
          small: { delivery: 35, installation: 30, both: 55 },
          medium: { delivery: 50, installation: 40, both: 75 },
          large: { delivery: 75, installation: 60, both: 115 },
        },
        // TODO: [TREE PRICE]. If one price applies to every size, enter it in all three.
        treePrice: { small: null, medium: null, large: null },
        maxTrees: 3,
      },
    },
  };
}

module.exports = { defaultSettings };
