import mongoose from 'mongoose';

const shopSchema = new mongoose.Schema(
  {
    shopNumber: {
      type: String,
      required: [true, 'Shop number is required'],
      unique: true,
      trim: true,
    },
    floor: {
      type: String,
      required: [true, 'Floor name is required'],
      enum: ['Basement', 'Ground Floor', '1st Floor', '2nd Floor', 'Rooftop'],
      default: 'Ground Floor',
    },
    utilityZone: {
      type: String,
      default: 'Standard Corridor Line',
      trim: true,
    },
    sizeSqFt: {
      type: Number,
      required: [true, 'Shop size in square feet is required'],
    },
    type: {
      type: String,
      enum: ['Retail Shop', 'Corporate Office', 'Storage Godown'],
      default: 'Retail Shop',
    },
    status: {
      type: String,
      enum: ['Available', 'Occupied', 'Maintenance'],
      default: 'Available',
    },
  },
  { timestamps: true }
);

const Shop = mongoose.model('Shop', shopSchema);
export default Shop;