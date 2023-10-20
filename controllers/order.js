import { Stripe } from 'stripe';
import { Order } from '../models/order.js';
import { sendMail } from './mail.js';
import { log } from 'console';
import { User } from '../models/user.js';


export const payment = (async (req, res, next) => {
  const stripee = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const { paymentMethodId, address, time, amount, order } = req.body;

    const paymentIntent = await stripee.paymentIntents.create({
      payment_method: paymentMethodId,
      description: "for cakeshop project",
      amount,
      currency: 'USD',
      shipping: {
        name: "jk",
        address: {
          line1: address,
          postal_code: "363641",
          city: "morbi",
          state: "gujarat",
          country: "US",
        },
      },
      confirm: true,
    });
    // Store the order in the database
    const orderr = new Order({
      user: req.user,
      paymentMethodId,
      address,
      time,
      amount,
      chargeId: paymentIntent.id,
      order,
    });
    // console.log("jk" + req.body)
    await orderr.save();

    const user = req.user;
    let totalPrice = amount + user.totalAmount;
    const result = await User.findByIdAndUpdate(user._id, { $set: { totalAmount: totalPrice } })

    // console.log("backend");
    sendMail(req.user, time, order, 0, "");
    res.status(200).json({ success: "true", client_secret: paymentIntent.client_secret });


  } catch (error) {
    next(error);
  }

});

export const getAllOrders = async (req, res, next) => {
  try {
    const orders = await Order.find();
    res.json(orders);
  } catch (error) {
    next(error);
  }
};

export const getConfirmedOrders = async (req, res, next) => {
  try {
    const orders = await Order.find();
    res.json(orders);
  } catch (error) {
    next(error);
  }
};

export const confirmOrder = async (req, res, next) => {
  const { data, suborder, order, time, msg } = req.body;
  try {
    let user = {
      name: order.user.name,
      email: order.user.email
    }
    if (data !== "") //not for not customized cake as we already sended mail for it.
      sendMail(user, time, suborder, data, msg);

    const updatedOrder = await Order.findOneAndUpdate(
      { _id: order._id, 'order._id': suborder._id },
      { $set: { 'order.$.isConfirmed': "confirm" } },
      { new: true }
    );

    if (data === 1 || data === "")
      res.json("order confirmed");
    else
      res.json("order cancelled");
  } catch (error) {
    next(error);
  }
};

//it returns orders for login entity.
export const getOrdersByUserEmail = async (req, res, next) => {
  try {
    const { email } = req.body; // Assuming email is a route parameter
    const orders = await Order.find({ 'user.email': email });

    if (!orders || orders.length === 0) {
      return res.status(404).json({ message: 'No orders found for this email.' });
    }
    const userOrders = orders.map(order => ({
      created_at: order.created_at,
      id: order._id,
      order: order.order,
      status:order.status
    }));
    res.json(userOrders);
  } catch (error) {
    next(error);
  }
};

export const getAdminOrders = async (req, res, next) => {
  try {
    const orders = await Order.find();

    if (!orders || orders.length === 0) {
      return res.status(404).json({ message: 'No orders found for this email.' });
    }
    // const Orders = orders.map(order => ({
    //   created_at: order.created_at,
    //   order: order.order,
    //   user: order.user,
    //   time: order.time
    // }));
    res.json(orders);
  } catch (error) {
    next(error);
  }
}

export const getCancelOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ 'status': 'cancelled' });

    if (!orders || orders.length === 0) {
      return res.status(404).json({ message: 'No orders found ' });
    }

    res.json(orders);
  } catch (error) {
    next(error);
  }
}
export const getNotCancelOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ 'status': { $ne: 'cancelled' } });

    if (!orders || orders.length === 0) {
      return res.status(404).json({ message: 'No orders found ' });
    }

    res.json(orders);
  } catch (error) {
    next(error);
  }
}

const refund = (order) => {
  let totalAmount = order.amount;

  const startDate = new Date();
  const endDate = new Date(order.time);

  // Calculate the time difference in milliseconds
  const timeDifference = endDate.getTime() - startDate.getTime();

  // Calculate the number of days by dividing the time difference by milliseconds in a day
  const daysPriorToDelivery = Math.floor(timeDifference / (1000 * 3600 * 24));
  // return numberOfDays;
  const refundPolicies = {
    0: 0,   // 0 days prior to delivery: No refund
    1: 0.25, // 1 to 3 days prior to delivery: 25% refund
    4: 0.50, // 4 to 7 days prior to delivery: 50% refund
    8: 0.75  // 8 or more days prior to delivery: 75% refund
    // You can add more policies as needed
  };

  // Calculate the applicable refund percentage based on the number of days prior to delivery
  let refundPercentage = 0;
  for (const days in refundPolicies) {
    if (daysPriorToDelivery >= parseInt(days)) {
      refundPercentage = refundPolicies[days];
    } else {
      break;
    }
  }
 
  // Calculate the refund amount based on the refund percentage
  const refundAmount = refundPercentage * totalAmount;
  
  return parseInt(refundAmount);
}

// Node.js route for handling order cancellations
export const cancelOrders = async (req, res) => {
  const { orderId, email } = req.body; // Assuming you send the orderId from the frontend

  try {
    // Initialize the stripe object with your secret key
    const stripee = new Stripe(process.env.STRIPE_SECRET_KEY);

    // Check if the order belongs to the requesting user
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.user.email !== email) {
      return res.status(403).json({ message: 'Unauthorized to cancel this order' });
    }
    if( refund(order)!==0)
    {
      const response = await stripee.refunds.create({
        payment_intent: order.chargeId,
        amount: refund(order),
      });

      // Update the order status in your database to reflect the cancellation
    order.status = 'cancelled';
    await order.save();
    return res.status(200).json({ message: 'Order cancelled successfully' });
    }
    else
    {
      return res.status(200).json({ message: 'Sorry,today is Delivery Date,so order cannot cancel' });
    }
    


    
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};


export const monthlyReport = async (req, res) => {
  const { year, month } = req.params;
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  try {
    const orders = await Order.find({
      created_at: { $gte: startDate, $lte: endDate },
    });

    const totalOrders = orders.length;
    const totalSales = orders.reduce((total, order) => total + order.amount, 0);

    const cakeCounts = {};
    let flavourCounts = {};
    let categoryCounts = {};
    const popularCakes = [];
    let customize=0,notCustomize=0;

    for (const order of orders) {
      for (const cakeOrder of order.order) {
        const cakeId = cakeOrder.cakeid;
        if(cakeOrder.customize) customize++;
        else notCustomize++;

        if (cakeCounts[cakeId]) {
          cakeCounts[cakeId]=(cakeCounts[cakeId] + cakeOrder.amount);
        } else {
          cakeCounts[cakeId] = cakeOrder.amount;
        }

        //for flavour
        const flavour = cakeOrder.flavour;
        if (flavourCounts[flavour]) {
          flavourCounts[flavour]=(flavourCounts[flavour] + cakeOrder.amount);
        } else {
          flavourCounts[flavour] = cakeOrder.amount;
        }

        //for category
        const category = cakeOrder.category;
        if (categoryCounts[category]) {
          categoryCounts[category]=(categoryCounts[category] + cakeOrder.amount);
        } else {
          categoryCounts[category] = cakeOrder.amount;
        }
      }
    }

    for (const [cakeId, count] of Object.entries(cakeCounts)) {
      const cakeOrder = orders
        .flatMap(order => order.order)
        .find(order => order.cakeid.toString() === cakeId);

      if (cakeOrder) {
        
        const name = cakeOrder.name;
        const cakeImage = cakeOrder.image;
        const price= cakeOrder.price;
        const _id=cakeOrder.cakeid;
        const category=cakeOrder.category;
        popularCakes.push({ name, image: cakeImage, count,price,_id,category });
      }
    }
    popularCakes.sort((a, b) => b.count - a.count);
     flavourCounts = Object.entries(flavourCounts);
     categoryCounts = Object.entries(categoryCounts);


 
    //year analyis
     let revenueData=[];
    for(var i=1;i<=12;i++)
    {
      let startDatee = new Date(year, i-1 , 1);
     let endDatee = new Date(year, i, 0);
     let orderss = await Order.find({
      created_at: { $gte: startDatee, $lte: endDatee },
    });

    let totalSaless = orderss.reduce((total, order) => total + order.amount, 0);
    revenueData.push({date: new Date(year, i-1, 1), revenue: totalSaless })

  }

     
    res.json({
      customize,
      notCustomize,
      totalOrders,
      totalSales,
      popularCakes,
      flavourCounts,
      categoryCounts,
      revenueData
    });
  } catch (error) {
    res.status(500).json({ error: 'An error occurred while fetching the data.' });
  }
};


