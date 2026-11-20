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

/** Holiday dates (Saturday/Sunday hours) for the 2026-27 and 2027-28 seasons. Add later years in /admin. */
function holidayDates() {
  const range = (from, to) => {
    const out = [];
    for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
    return out;
  };
  return [
    '2026-11-26', // Thanksgiving
    ...range('2026-12-20', '2027-01-06'), // Christmas season incl. New Year's Day
    '2027-01-18', // Martin Luther King Jr. Day
    '2027-02-15', // Presidents Day
    '2027-05-31', // Memorial Day
    '2027-06-19', // Juneteenth
    '2027-07-04', '2027-07-05', // Independence Day + observed
    '2027-09-06', // Labor Day
    '2027-11-11', // Veterans Day
    '2027-11-25', // Thanksgiving
    ...range('2027-12-20', '2028-01-06'), // Christmas season
  ];
}

function defaultSettings() {
  return {
    business: {
      name: 'SAE Outdoor and Haul',
      phone: '4696864690', // provided by owner
      textNumber: '4696864690', // owner confirmed: same number takes texts
      email: 'Helpcentre403@gmail.com', // provided by owner
      baseAddress: 'Carrollton, TX', // owner: "centre of Carrollton"
      // Addresses whose geocoded city is in this list get a $0 distance fee.
      freeCities: ['Carrollton'],
      serviceAreaCities: [
        'Plano', 'Frisco', 'Irving', 'Richardson', 'Garland', 'Carrollton',
        'Farmers Branch', 'Addison', 'Lewisville', 'Denton', 'Coppell', 'Flower Mound',
      ],
    },
    content: {
      // Drafted by the developer at the owner's request ("make them up"). Owner should confirm.
      dontTake: 'Hazardous materials such as chemicals, solvents, pesticides, gasoline, asbestos, and medical waste, plus anything leaking or flammable. Tires, paint, and heavy materials like concrete, dirt, or roofing are handled case by case and quoted separately',
      needToBeHome: "Not always. For driveway or curbside pickups, lawn visits, and Christmas tree drop-offs, you don't need to be home as long as we can reach the spot and you've told us where to go. For anything inside your home, garage, or shed, an adult needs to be there to let us in and point out the items.",
      paymentMethods: "Payment is due when the job is finished. We'll confirm the payment options we accept when we text to confirm your booking.",
      holidayNote: 'Thanksgiving, the Christmas season (Dec 20 to Jan 6), New Year\'s Day, and other major holidays use our Saturday and Sunday hours. Christmas Eve: 10:00 AM to 4:00 PM. Closed Christmas Day.',
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
      // Owner: major holidays + Dec 20 to Jan 6 use Saturday/Sunday hours.
      holidays: holidayDates(),
      // Owner: closed Christmas Day.
      blockedDates: ['2026-12-25', '2027-12-25'],
      // Owner: Christmas Eve closes at 4 PM. Special hours for one date override everything else.
      specialHours: [
        { date: '2026-12-24', open: '10:00', close: '16:00' },
        { date: '2027-12-24', open: '10:00', close: '16:00' },
      ],
      blockedSlots: [], // { date, time } single slots closed
      openedSlots: [], // { date, time } extra slots opened outside normal hours
    },
    rates: {
      distance: {
        // Driving miles from the base address, rounded to the nearest whole mile.
        bands: [
          // Owner: flat $10 for any address outside Carrollton, up to 20 driving miles.
          { label: 'Outside Carrollton', maxMiles: 20, fee: 10 },
        ],
        maxServiceMiles: 20, // owner: no travel past 20 miles
      },
      junk: {
        minimumCharge: 100, // owner: every junk job has a $100 minimum (whole job)
        loads: {
          minimum: { label: 'Minimum pickup', price: p(100) },
          quarter: { label: '1/4 load', price: p(150) },
          half: { label: '1/2 load', price: p(250) },
          threeQuarter: { label: '3/4 load', price: p(350) },
          full: { label: 'Full load', price: p(450, 550) },
          overFull: { label: 'Over full load (extra-heavy)', price: p(550, 700) },
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
          constructionDebris: { label: 'Construction debris', price: p(150) },
        },
        cleanouts: {
          smallGarage: { label: 'Small garage', price: p(200) },
          largeGarage: { label: 'Large garage', price: p(400, 650) },
          shed: { label: 'Shed', price: p(175, 350) },
          storageUnit: { label: 'Storage unit', price: p(200, 450) },
          apartment: { label: 'Apartment', price: p(300, 650) },
          house: { label: 'House', price: p(600, 1500) },
          rental: { label: 'Rental property', price: p(300, 800) },
        },
        extras: {
          heavyLifting: { label: 'Heavy lifting', price: p(25, 75) },
          stairs: { label: 'Elevated (upper floor or stairs)', price: p(25, 75) },
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
        // Owner: estimate "over $60" per tree; the crew tells the customer the exact price.
        treePrice: { small: p(60, 60, true), medium: p(60, 60, true), large: p(60, 60, true) },
        maxTrees: 3,
      },
    },
  };
}

module.exports = { defaultSettings };
